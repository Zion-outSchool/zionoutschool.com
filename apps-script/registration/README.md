# Registration records in the portal

The registration page still sends Step 1 and the final submission to the existing Apps Script web app. The portal sync runs after the final documents have been saved to Drive. Do not call the sync at folder creation.

1. Apply `supabase_registration_records.sql` and then `supabase_registration_review.sql` after the portal account and gradebook migrations.
2. Deploy the `registration-sync` Edge Function with gateway JWT verification disabled for this endpoint. Set `REGISTRATION_SYNC_KEY` as an Edge Function secret. The handler verifies this dedicated secret before reading any submission. Keep the Supabase service role key in the Edge Function runtime.
3. Create a restricted Drive folder for the retry queue, accessible to the registration script owner and authorized administrators. Do not use a parent-shared student folder for this queue.
4. Add `PortalSync.gs` to the existing Google Apps Script project. Set these Script Properties.

   | Property | Value |
   | --- | --- |
   | `REGISTRATION_SYNC_QUEUE_FOLDER_ID` | Private retry queue folder ID |
   | `REGISTRATION_SYNC_URL` | The deployed `https://<project>.supabase.co/functions/v1/registration-sync` URL |
   | `REGISTRATION_SYNC_KEY` | The same dedicated secret used by the Edge Function, with at least 32 characters |

5. In the final-submission handler, immediately before returning its existing success response, call `queuePortalRegistration_(payload, result)` with the parsed request and the existing response object, before JSON serialization. The code expects `payload.step` to be `2` and `result.result` to be `success`.
6. Run `installPortalRegistrationSync` in the registration editor as the project owner. The function checks the queue and Supabase endpoint before enabling five-minute retries. Redeploy the existing web app, then test a completed submission with fictional student data.

A sync failure leaves the queued item for retry. Validation failures are labeled `needs-review-` in the same restricted folder. The worker trashes successfully synced queue files, and retries with the same student folder preserve the record and its roster link.

An administrator reviews each registration in **Student Records** and links it to an existing student or creates a roster entry. A teacher can open the latest linked record for a student on their classroom roster. From a linked student, select **Edit registration fields** to update the student's operational registration data. Teachers can suggest preferred-name or guardian-contact corrections through the existing review workflow. The broader office fields are for administrators.

The sync copies the registration field values used by the portal. Signatures, signed statements and dates, and uploaded files stay in Google Drive. The final submission checklist is a form validation step. From Student Records, administrators can open the student's original Drive folder directly. Earlier records can have blank fields that the old sync did not collect. Use the original in Drive when filling those blanks.
