import type { NewsItem } from "../lib/parse-news";
import { atomWithStorage } from "jotai/utils";

export const showNewsModalAtom = atomWithStorage("showNewsModal", false, undefined, { getOnInit: true });
export const newsAtom = atomWithStorage<NewsItem | null>("news", null, undefined, { getOnInit: true });
