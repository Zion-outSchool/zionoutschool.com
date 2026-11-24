function installPortalReplySync() {
  syncPortalEmailReplies();
  if (!ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === 'syncPortalEmailReplies')) {
    ScriptApp.newTrigger('syncPortalEmailReplies').timeBased().everyMinutes(1).create();
  }
  console.log('Automatic portal reply checks are enabled.');
}

function listPortalReplyCandidates(checkpoint, profile) {
  const ids = new Set();
  if (checkpoint) {
    let pageToken;
    let lastPage;
    try {
      do {
        lastPage = Gmail.Users.History.list('me', {
          startHistoryId: checkpoint, historyTypes: ['messageAdded'], maxResults: 100, pageToken
        });
        for (const record of lastPage.history || []) {
          for (const entry of record.messagesAdded || []) ids.add(entry.message.id);
        }
        pageToken = lastPage.nextPageToken;
      } while (pageToken);
      return {ids, checkpoint: lastPage.historyId};
    } catch (error) {
      if (!/404|Requested entity was not found/i.test(String(error))) throw error;
      ids.clear();
    }
  }
  let pageToken;
  do {
    const batch = Gmail.Users.Messages.list('me', {
      q: 'newer_than:7d -in:sent -in:drafts -in:trash -in:spam', maxResults: 100, pageToken
    });
    for (const message of batch.messages || []) ids.add(message.id);
    pageToken = batch.nextPageToken;
  } while (pageToken);
  return {ids, checkpoint: profile.historyId};
}

function syncPortalEmailReplies() {
  processPortalEmailReplies(false);
}

function retryPortalReplyReview() {
  processPortalEmailReplies(true);
}

function processPortalEmailReplies(retryReview) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const properties = PropertiesService.getScriptProperties();
    const mailbox = (properties.getProperty('COMMUNICATION_REPLY_ADDRESS') || '').toLowerCase();
    const owner = (properties.getProperty('COMMUNICATION_MAILBOX_OWNER') || mailbox).toLowerCase();
    const prefix = properties.getProperty('COMMUNICATION_REPLY_TAG_PREFIX') || '';
    const endpoint = properties.getProperty('COMMUNICATION_REPLY_URL');
    const key = properties.getProperty('COMMUNICATION_INBOUND_KEY');
    const baseAddress = /^[a-z0-9][a-z0-9._-]*@[a-z0-9.-]+\.[a-z]{2,}$/;
    if (!baseAddress.test(mailbox) || !baseAddress.test(owner) || !/^[a-z0-9-]{0,20}$/.test(prefix) ||
        !/^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/communication-email\/reply$/.test(endpoint || '') ||
        !key || key.length < 32) {
      throw new Error('The portal reply mailbox is not configured.');
    }
    const profile = Gmail.Users.getProfile('me');
    if (profile.emailAddress.toLowerCase() !== owner) {
      throw new Error('Run this script from the account that receives portal replies.');
    }

    const filed = 'Zion-Portal-Filed';
    const review = 'Zion-Portal-Review';
    const labels = Gmail.Users.Labels.list('me').labels || [];
    function labelId(name) {
      const existing = labels.find(label => label.name === name);
      return existing ? existing.id : Gmail.Users.Labels.create({name}, 'me').id;
    }
    const filedId = labelId(filed);
    const reviewId = labelId(review);
    const [local, domain] = mailbox.split('@');
    const escape = value => value.replaceAll('.', '\\.');
    const exactAddress = new RegExp('(?:^|[\\s<,;])' + escape(local) +
        '\\+' + prefix + '[a-f0-9]{32}@' + escape(domain) + '(?=$|[\\s>,;])', 'i');
    const batch = retryReview
      ? {ids: new Set((Gmail.Users.Messages.list('me', {labelIds: [reviewId], maxResults: 40}).messages || []).map(message => message.id))}
      : listPortalReplyCandidates(properties.getProperty('COMMUNICATION_GMAIL_HISTORY_ID'), profile);
    const ignoredLabels = ['SENT', 'DRAFT', 'SPAM', 'TRASH', filedId];
    if (!retryReview) ignoredLabels.push(reviewId);
    let imported = 0;
    let needsReview = 0;

    for (const id of batch.ids) {
      let metadata;
      try {
        metadata = Gmail.Users.Messages.get('me', id, {format: 'metadata', metadataHeaders: ['To']});
      } catch (error) {
        if (/404|Requested entity was not found/i.test(String(error))) continue;
        throw error;
      }
      if ((metadata.labelIds || []).some(label => ignoredLabels.includes(label))) continue;
      const recipients = (metadata.payload?.headers || []).filter(header => header.name.toLowerCase() === 'to');
      if (!recipients.some(header => exactAddress.test(header.value))) continue;
      const message = Gmail.Users.Messages.get('me', id, {format: 'raw'});
      let label = reviewId;
      if (typeof message.raw === 'string' && message.raw.length > 0 && message.raw.length <= 1398104) {
        const response = UrlFetchApp.fetch(endpoint, {
          method: 'post',
          contentType: 'application/json',
          headers: {Authorization: 'Bearer ' + key},
          payload: JSON.stringify({id, raw: message.raw}),
          muteHttpExceptions: true,
          followRedirects: false
        });
        const status = response.getResponseCode();
        if (status === 200) label = filedId;
        else if ([400, 403, 413].includes(status)) {
          let reason;
          try { reason = JSON.parse(response.getContentText()).error; } catch {}
          const known = ['Invalid reply.', 'Unreadable email.', 'Reply is not addressed to a student conversation.',
            'No reply text was found.', 'Reply text is too long.', 'Reply is not authorized.', 'Reply too large.'];
          console.log('Reply needs review (HTTP ' + status + '). ' + (known.includes(reason) ? reason : ''));
        } else throw new Error('Portal reply service returned HTTP ' + status + '.');
      } else {
        console.log('Reply needs review. Gmail returned no raw message or it exceeds the size limit.');
      }
      const update = label === filedId ? {addLabelIds: [filedId], removeLabelIds: [reviewId]} : {addLabelIds: [reviewId]};
      Gmail.Users.Messages.modify(update, 'me', id);
      if (label === filedId) imported++;
      else needsReview++;
    }
    if (batch.checkpoint) properties.setProperty('COMMUNICATION_GMAIL_HISTORY_ID', String(batch.checkpoint));
    console.log('Portal replies filed: ' + imported + '. Need review: ' + needsReview + '.');
  } finally {
    lock.releaseLock();
  }
}
