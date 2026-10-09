import React from "react";
import UpscaylSVGLogo from "@/components/icons/upscayl-logo-svg";
import { useAtomValue } from "jotai";
import { translationAtom } from "@/atoms/translations-atom";

export default function Header() {
  const t = useAtomValue(translationAtom);

  return (
      <div className="flex items-center gap-3 px-5 py-5">
        <UpscaylSVGLogo className="inline-block h-14 w-14" />
        <div className="flex flex-col justify-center">
          <h1 className="text-3xl font-bold">
            {t("TITLE")}
          </h1>
          <p className="">{t("HEADER.DESCRIPTION")}</p>
        </div>
      </div>
  );
}
