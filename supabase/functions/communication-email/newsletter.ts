export type NewsletterEntry = {
  title: string;
  body: string;
  author_name: string;
  links: { label: string; url: string }[];
  photos: { path: string; alt: string }[];
  documents?: { path: string; label: string }[];
};

type NewsletterContent = { html: string; text: string };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

function httpsUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password) return url.href;
  } catch {
    // Skip invalid links while keeping the rest of the entry.
  }
  return "";
}

export function renderNewsletter(
  subject: string,
  url: string,
  entries: NewsletterEntry[],
  photos: ReadonlyMap<string, string>,
): NewsletterContent {
  const header = '<div style="max-width:640px;margin:0 auto;padding:18px;font-family:Arial,sans-serif;color:#233a31">' +
    '<h1 style="margin:0;padding:20px;background:#24483d;color:#fff;font-size:25px">' + escapeHtml(subject) + "</h1>";
  const archive = '<p><a style="color:#24483d;font-weight:bold" href="' + escapeHtml(url) +
    '">Read this issue in the Family Portal</a></p>';
  const footer = "Read this issue in the Family Portal: " + url;
  const textParts = [subject, footer];
  const htmlParts = [header, archive];
  const encoder = new TextEncoder();
  let size = encoder.encode(header + archive).length;

  for (const entry of entries) {
    const links = entry.links.map(link => ({ ...link, url: httpsUrl(link.url) })).filter(link => link.url);
    for (const document of entry.documents ?? []) {
      links.push({ label: document.label + " (PDF in the Family Portal)", url });
    }
    const images = entry.photos.flatMap(photo => {
      const source = httpsUrl(photos.get(photo.path) ?? "");
      if (!source) return [];
      return '<p><img style="display:block;max-width:100%;height:auto" width="460" src="' +
        escapeHtml(source) + '" alt="' + escapeHtml(photo.alt) + '"></p>';
    });
    const linksHtml = links.length
      ? "<ul>" + links.map(link => '<li><a href="' + escapeHtml(link.url) + '">' +
          escapeHtml(link.label) + "</a></li>").join("") + "</ul>"
      : "";
    const section = '<div style="padding:14px 0;border-top:1px solid #cbd8ce">' +
      '<h2 style="margin:0 0 5px;font-size:20px">' + escapeHtml(entry.title) + "</h2>" +
      '<p style="margin:0;color:#506359">' + escapeHtml(entry.author_name) + "</p>" +
      "<p>" + escapeHtml(entry.body).replace(/\r\n|\r|\n/g, "<br>") + "</p>" +
      linksHtml + images.join("") + "</div>";
    const entrySize = encoder.encode(section).length;
    if (size + entrySize > 75000) {
      const note = "Read the full issue in the Family Portal for more updates.";
      htmlParts.push("<p>" + note + "</p>");
      textParts.push(note);
      break;
    }
    size += entrySize;
    htmlParts.push(section);
    textParts.push([
      entry.title, entry.author_name, entry.body,
      ...links.map(link => link.label + ": " + link.url),
    ].join("\n"));
  }
  textParts.push(footer);
  htmlParts.push(archive, "</div>");
  return { text: textParts.join("\n\n"), html: htmlParts.join("") };
}
