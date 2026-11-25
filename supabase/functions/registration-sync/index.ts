import { createClient } from "npm:@supabase/supabase-js@2";

const syncKey = Deno.env.get("REGISTRATION_SYNC_KEY") || "";
const server = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
const encoder = new TextEncoder();
const expected = crypto.subtle.digest("SHA-256", encoder.encode(syncKey));

async function validSyncKey(candidate: string) {
  if (syncKey.length < 32 || !candidate || candidate.length > 256) return false;
  const [left, right] = await Promise.all([expected, crypto.subtle.digest("SHA-256", encoder.encode(candidate))]);
  const actual = new Uint8Array(right);
  let difference = 0;
  for (const [index, byte] of new Uint8Array(left).entries()) difference |= byte ^ actual[index];
  return difference === 0;
}

function text(value: unknown, limit = 250) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

Deno.serve(async (request) => {
  const json = (body: object, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!await validSyncKey(request.headers.get("x-registration-sync-key") || "")) {
    return json({ error: "Registration sync access required." }, 401);
  }
  const raw = await request.text();
  if (raw.length > 150000) return json({ error: "Record is too large." }, 413);
  let fields;
  try {
    fields = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid registration payload." }, 400);
  }
  const folder = text(fields?.studentFolderId, 128);
  const firstName = text(fields?.studentFirstName, 120);
  const lastName = text(fields?.studentLastName, 120);
  const grade = text(fields?.studentGrade, 25);
  const gradeLevel = grade === "Kindergarten" ? "K" : grade.replace(/(st|nd|rd|th)$/, "");
  if (!/^[A-Za-z0-9_-]{10,128}$/.test(folder) || !firstName || !lastName || !/^(K|[1-9]|1[0-2])$/.test(gradeLevel)) {
    return json({ error: "The registration is missing a valid folder, student name, or grade." }, 422);
  }

  const guardians = [1, 2].map((index) => ({
    name: text(fields[`parent${index}Name`], 120),
    phone: text(fields[`parent${index}Phone`], 60),
    email: text(fields[`parent${index}Email`], 254),
  }));
  const emergencyContacts = [1, 2, 3].map((index) => ({
    name: text(fields[`ec${index}Name`], 120),
    relationship: text(fields[`ec${index}Relationship`], 120),
    phone: text(fields[`ec${index}Phone`], 60),
    medicalPermission: text(fields[`ec${index}Medical`]),
  }));
  const authorizedPickup = [1, 2, 3].map((index) => ({
    name: text(fields[`pickup${index}Name`], 120),
    relationship: text(fields[`pickup${index}Relationship`], 120),
    phone: text(fields[`pickup${index}Phone`], 60),
  }));

  const classroomRecord = {
    firstName, lastName, preferredName: text(fields.studentPreferred, 120), gradeLevel,
    guardians, emergencyContacts, authorizedPickup,
    pickupRestriction: text(fields.custodyOrder),
    allergyStatus: text(fields.lifeThreateningAllergy),
    allergyInstructions: fields.lifeThreateningAllergy === "Yes" ? text(fields.allergyDetails, 2000) : "",
    emergencyMedication: text(fields.emergencyMedication),
    emergencyInstructions: text(fields.emergencyMedication).startsWith("Yes") ? text(fields.emergencyMedDetails, 2000) : "",
    treatmentConsent: text(fields.medicalConsent),
    treatmentInstructions: text(fields.medicalConsent).startsWith("No") ? text(fields.noEmergencyExplanation, 2000) : "",
    mediaConsent: text(fields.photoConsent),
  };
  const takesMedication = fields.prescribedMedication === "Yes";
  const administratorRecord = {
    dateOfBirth: text(fields.studentDOB, 20),
    previousSchool: text(fields.previousSchool),
    iepStatus: text(fields.studentIEP),
    immunizationStatus: text(fields.immunizationStatus),
    guardianAddresses: [1, 2].map((index) => text(fields[`parent${index}Address`], 500)),
    prescribedMedication: text(fields.prescribedMedication),
    medicationDuringSchool: takesMedication ? text(fields.medicationDuringSchool) : "",
    medicationDetails: takesMedication ? text(fields.medicationDetails, 2000) : "",
    medicationAdmin: takesMedication ? text(fields.medicationAdmin) : "",
    medicationStorage: takesMedication ? text(fields.medicationStorage, 120) : "",
    medicationBehavior: takesMedication ? text(fields.medicationBehavior) : "",
    medicationBehaviorInfo: takesMedication && fields.medicationBehavior === "Yes"
      ? text(fields.medicationBehaviorInfo, 2000) : "",
    medicationDisruption: takesMedication ? text(fields.medicationDisruption, 2000) : "",
    staffTraining: text(fields.emergencyMedication).startsWith("Yes") ? text(fields.staffTraining) : "",
    siblings: text(fields.siblings),
    siblingNames: fields.siblings === "Yes" ? text(fields.siblingNames, 2000) : "",
    efaStatus: text(fields.efaStatus),
    classWallet: text(fields.efaStatus).startsWith("Yes") ? text(fields.classWallet) : "",
    liabilityAck: text(fields.liabilityAck),
  };

  // Retrying a completed registration must never reset its school roster link.
  const { error } = await server.from("registration_records").upsert({
    drive_folder_id: folder, classroom_record: classroomRecord, administrator_record: administratorRecord,
  }, { onConflict: "drive_folder_id", ignoreDuplicates: true });
  if (error) {
    console.error("Registration sync could not persist a record.", error.code);
    return json({ error: "Registration sync is temporarily unavailable." }, 503);
  }
  return json({ saved: true });
});
