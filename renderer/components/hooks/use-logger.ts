import { logAtom } from "../../atoms/log-atom";
import { useSetAtom } from "jotai";

const useLogger = () => {
  const setLogData = useSetAtom(logAtom);

  const logit = (...args: any) => {
    const data = [...args].join(" ");
    console.log(...args);
    window.electron.writeLog(data);
    setLogData((prevLogData) => [...prevLogData, data]);
  };

  return logit;
};

export default useLogger;
