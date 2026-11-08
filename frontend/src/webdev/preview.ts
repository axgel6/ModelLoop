export interface ProjectFile {
  path: string;
  content: string;
}

/** One HTML document from the project: its stylesheets and scripts put inline, for the preview frame */
export function buildPreview(files: ProjectFile[]): string {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const html = byPath.get("index.html") ?? "<p>No index.html yet.</p>";
  return html
    .replace(/<link[^>]+href="([^"]+\.css)"[^>]*>/g, (tag, href: string) =>
      byPath.has(href) ? `<style>\n${byPath.get(href)}\n</style>` : tag,
    )
    .replace(/<script[^>]+src="([^"]+\.js)"[^>]*><\/script>/g, (tag, src: string) =>
      byPath.has(src) ? `<script>\n${byPath.get(src)!.replace(/<\/script/gi, "<\\/script")}\n</script>` : tag,
    );
}
