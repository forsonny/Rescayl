import { useEffect } from "react";

const useElectron = ({
  subscribe,
  func,
}: {
  subscribe: (listener: (data: any) => void) => () => void;
  func: (data: any) => void;
}) => {
  useEffect(() => subscribe(func), [subscribe, func]);
};
