// Install a time-driven trigger for syncPortalEmailReplies in the mailbox that receives replies.
function syncPortalEmailReplies() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const properties = PropertiesService.getScriptProperties();
    const mailbox = (properties.getProperty('COMMUNICATION_REPLY_ADDRESS') || '').toLowerCase();
    const owner = (properties.getProperty('COMMUNICATION_MAILBOX_OWNER') || mailbox).toLowerCase();
    const endpoint = properties.getProperty('COMMUNICATION_REPLY_URL');
    const key = properties.getProperty('COMMUNICATION_INBOUND_KEY');
    const baseAddress = /^[a-z0-9][a-z0-9._-]*@[a-z0-9.-]+\.[a-z]{2,}$/;
    if (!baseAddress.test(mailbox) || !baseAddress.test(owner) ||
        !/^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/communication-email\/reply$/.test(endpoint || '') ||
        !key || key.length < 32) {
      throw new Error('The portal reply mailbox is not configured.');
    }
    if (Gmail.Users.getProfile('me').emailAddress.toLowerCase() !== owner) {
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
        '\\+[a-f0-9]{32}@' + escape(domain) + '(?=$|[\\s>,;])', 'i');
    const recipientQuery = owner === mailbox ? '' : ' to:"' + local + '"';
    const list = Gmail.Users.Messages.list('me', {
      q: 'in:inbox -label:' + filed + ' -label:' + review + recipientQuery, maxResults: 40
    });

    for (const row of list.messages || []) {
      const metadata = Gmail.Users.Messages.get('me', row.id, {format: 'metadata', metadataHeaders: ['To']});
      const recipients = (metadata.payload?.headers || []).filter(header => header.name.toLowerCase() === 'to');
      if (!recipients.some(header => exactAddress.test(header.value))) continue;
      const message = Gmail.Users.Messages.get('me', row.id, {format: 'raw'});
      let label = reviewId;
      if (message.raw && (message.sizeEstimate || 0) <= 1048576 && message.raw.length <= 1398104) {
        const response = UrlFetchApp.fetch(endpoint, {
          method: 'post',
          contentType: 'application/json',
          headers: {Authorization: 'Bearer ' + key},
          payload: JSON.stringify({id: row.id, raw: message.raw}),
          muteHttpExceptions: true,
          followRedirects: false
        });
        const status = response.getResponseCode();
        if (status === 200) label = filedId;
        else if (![400, 403, 413].includes(status)) throw new Error('Portal reply service returned HTTP ' + status + '.');
      }
      Gmail.Users.Messages.modify({addLabelIds: [label]}, 'me', row.id);
    }
  } finally {
    lock.releaseLock();
  }
}
