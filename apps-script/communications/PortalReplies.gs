// Install a time-driven trigger for syncPortalEmailReplies in the dedicated reply mailbox.
function syncPortalEmailReplies() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const properties = PropertiesService.getScriptProperties();
    const mailbox = (properties.getProperty('COMMUNICATION_REPLY_ADDRESS') || '').toLowerCase();
    const endpoint = properties.getProperty('COMMUNICATION_REPLY_URL');
    const key = properties.getProperty('COMMUNICATION_INBOUND_KEY');
    if (!/^[^\s+@]+@[^\s@]+\.[^\s@]+$/.test(mailbox) ||
        !/^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/communication-email\/reply$/.test(endpoint || '') ||
        !key || key.length < 32) {
      throw new Error('The portal reply mailbox is not configured.');
    }
    if (Gmail.Users.getProfile('me').emailAddress.toLowerCase() !== mailbox) {
      throw new Error('Run this script from the dedicated portal reply mailbox.');
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
    const list = Gmail.Users.Messages.list('me', {
      q: 'in:inbox -label:' + filed + ' -label:' + review, maxResults: 20
    });

    for (const row of list.messages || []) {
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
