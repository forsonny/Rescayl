import { newsAtom, showNewsModalAtom } from "@/atoms/news-atom";
import { translationAtom } from "@/atoms/translations-atom";
import { useAtomValue, useSetAtom } from "jotai";
import React from "react";

function Footer({ version }: { version: string | null }) {
  const setShowNewsModal = useSetAtom(showNewsModalAtom);
  const news = useAtomValue(newsAtom);
  const t = useAtomValue(translationAtom);

  return (
    <div className="p-2 text-center text-xs text-base-content/50">
      {news && !news?.data?.dontShow && (
        <button
          className="badge badge-neutral mb-2"
          onClick={() => setShowNewsModal(true)}
        >
          {t("FOOTER.NEWS_TITLE")}
        </button>
      )}
      <details>
        <summary className="cursor-pointer py-1 text-base-content/80">About Rescayl</summary>
        <div className="space-y-1 py-2">
      {version && <p>Version {version}</p>}
      <p>
        {t("FOOTER.COPYRIGHT")} {new Date().getFullYear()} -{" "}
        <a
          className="font-bold"
          href="https://github.com/forsonny/Rescayl"
          target="_blank"
        >
          {t("TITLE")}
        </a>
      </p>
      <p>Maintained by <a href="https://github.com/forsonny/Rescayl" target="_blank" className="font-bold">forsonny</a></p>
      <p>
        Based on Upscayl · {" "}
        <a
          href="https://github.com/upscayl"
          className="font-bold"
          target="_blank"
        >
          {t("FOOTER.LINK_TITLE")}
        </a>
      </p>
        </div>
      </details>
    </div>
  );
}

export default Footer;
