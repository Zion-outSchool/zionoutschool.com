// Call queuePortalRegistration_(payload, result) after the existing final registration succeeds.
// The final submission and Google Drive response remain independent of delivery to the portal.
function queuePortalRegistration_(payload, result) {
  if (String(payload && payload.step) !== '2' || !result || result.result !== 'success') return;

  try {
    const properties = PropertiesService.getScriptProperties();
    const folderId = properties.getProperty('REGISTRATION_SYNC_QUEUE_FOLDER_ID');
    const studentFolderId = payload.studentFolderId;
    if (!folderId || !/^[A-Za-z0-9_-]{10,128}$/.test(studentFolderId || '')) {
      throw new Error('Missing registration sync queue or valid student folder.');
    }

    const fields = [
      'studentFolderId', 'studentFirstName', 'studentLastName', 'studentPreferred',
      'studentGrade', 'studentDOB', 'previousSchool', 'studentIEP', 'immunizationStatus',
      'custodyOrder', 'lifeThreateningAllergy', 'allergyDetails', 'emergencyMedication',
      'emergencyMedDetails', 'medicalConsent', 'noEmergencyExplanation', 'photoConsent',
      'prescribedMedication', 'medicationDuringSchool', 'medicationDetails', 'medicationAdmin',
      'medicationStorage', 'medicationBehavior', 'medicationBehaviorInfo', 'medicationDisruption',
      'staffTraining', 'siblings', 'siblingNames', 'efaStatus', 'classWallet', 'liabilityAck'
    ];
    for (let index = 1; index <= 2; index++) {
      for (const suffix of ['Name', 'Phone', 'Email', 'Address']) fields.push('parent' + index + suffix);
    }
    for (let index = 1; index <= 3; index++) {
      for (const suffix of ['Name', 'Relationship', 'Phone']) {
        fields.push('ec' + index + suffix, 'pickup' + index + suffix);
      }
      fields.push('ec' + index + 'Medical');
    }

    const record = {};
    for (const field of fields) {
      if (typeof payload[field] === 'string') record[field] = payload[field].trim().slice(0, 2000);
    }

    const folder = DriveApp.getFolderById(folderId);
    const name = 'portal-registration-' + studentFolderId + '.json';
    const lock = LockService.getScriptLock();
    lock.waitLock(5000);
    let queued;
    try {
      const existing = folder.getFilesByName(name);
        if (!existing.hasNext()) queued = folder.createFile(name, JSON.stringify(record), 'application/json');
    } finally {
      lock.releaseLock();
    }
    if (queued) deliverPortalRegistration_(queued, properties);
  } catch (_error) {
    // Keep the existing registration response intact. Leave queued files available for retry.
    console.error('Portal registration sync did not finish. Check the retry queue and deployment settings.');
  }
}

function installPortalRegistrationSync() {
  const properties = PropertiesService.getScriptProperties();
  const queue = properties.getProperty('REGISTRATION_SYNC_QUEUE_FOLDER_ID');
  const settings = portalRegistrationDeliverySettings_(properties);
  if (!queue || !settings) throw new Error('Set the registration sync queue, URL and key in Script Properties before installing.');
  DriveApp.getFolderById(queue).getName();
  const response = UrlFetchApp.fetch(settings.url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-registration-sync-key': settings.key },
    payload: '{}',
    muteHttpExceptions: true,
    followRedirects: false
  });
  if (response.getResponseCode() !== 422) throw new Error('Supabase did not verify the registration sync connection. Check the URL and key.');
  if (!ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === 'retryPortalRegistrations')) {
    ScriptApp.newTrigger('retryPortalRegistrations').timeBased().everyMinutes(5).create();
  }
  console.log('Registration sync verified. Automatic retries are enabled.');
}

function retryPortalRegistrations() {
  const properties = PropertiesService.getScriptProperties();
  const folderId = properties.getProperty('REGISTRATION_SYNC_QUEUE_FOLDER_ID');
  if (!folderId) throw new Error('Registration sync queue is not configured.');
  const files = DriveApp.getFolderById(folderId).getFilesByType('application/json');
  let attempts = 0;
  while (files.hasNext() && attempts < 20) {
    const file = files.next();
    if (!file.getName().startsWith('portal-registration-')) continue;
    attempts++;
    deliverPortalRegistration_(file, properties);
  }
}

function portalRegistrationDeliverySettings_(properties) {
  const url = properties.getProperty('REGISTRATION_SYNC_URL');
  const key = properties.getProperty('REGISTRATION_SYNC_KEY');
  return url && /^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/registration-sync$/.test(url)
      && key && key.length >= 32 ? {url, key} : null;
}

function deliverPortalRegistration_(file, properties) {
  const settings = portalRegistrationDeliverySettings_(properties);
  if (!settings) {
    console.error('Portal registration sync URL or key is not configured.');
    return;
  }

  try {
    const response = UrlFetchApp.fetch(settings.url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-registration-sync-key': settings.key },
      payload: file.getBlob().getDataAsString(),
      muteHttpExceptions: true,
      followRedirects: false
    });
    if (response.getResponseCode() === 200 && JSON.parse(response.getContentText()).saved === true) {
      file.setTrashed(true);
    } else if ([400, 413, 422].includes(response.getResponseCode())) {
      file.setName('needs-review-' + file.getName());
      console.error('A registration sync file needs review. Response code: ' + response.getResponseCode());
    } else {
      console.error('Portal registration sync will retry. Response code: ' + response.getResponseCode());
    }
  } catch (_error) {
    console.error('Portal registration sync will retry after a delivery error.');
  }
}
