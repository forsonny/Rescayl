export type NewsItem = {
  data: { title?: string; version: string; dontShow?: boolean };
  content: string;
  seen?: boolean;
};

// News supports flat metadata only. Language overrides, executable engines,
// YAML tags and nested structures are never interpreted.
export function parseNews(source: string): NewsItem {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(source);
  if (!match) throw new Error("Invalid news metadata.");
  const data: NewsItem["data"] = { version: "" };
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const entry = /^(title|version|dontShow):\s*(.+)$/.exec(line);
    if (!entry) throw new Error("Unsupported news metadata.");
    const [, key, raw] = entry;
    const value = raw.trim();
    if (key === "dontShow") {
      if (value !== "true" && value !== "false") throw new Error("Invalid news visibility.");
      data.dontShow = value === "true";
    } else {
      const scalar = value.startsWith('"') ? JSON.parse(value) : value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1).replace(/''/g, "'") : value;
      if (typeof scalar !== "string" || !scalar) throw new Error("Invalid news value.");
      data[key as "title" | "version"] = scalar;
    }
  }
  if (!data.version) throw new Error("News version is required.");
  return { data, content: match[2] };
}
