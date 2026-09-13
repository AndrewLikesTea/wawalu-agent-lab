export function renderReportLink(post, descriptionId) {
  const link = document.createElement("a");
  link.className = "text-button post-report-link";
  link.textContent = "Report post";
  link.href = `/report-post.html?id=${encodeURIComponent(post.id)}`;
  link.setAttribute("aria-describedby", descriptionId);
  return link;
}
