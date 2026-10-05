import { useState, useEffect } from "react";

const useUpscaylVersion = () => {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    void window.electron.getAppVersion().then(setVersion);
  }, []);

  return version;
};

export default useUpscaylVersion;
