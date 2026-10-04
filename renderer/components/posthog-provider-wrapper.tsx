import { enableContributionAtom } from "@/atoms/user-settings-atom";
import { useAtomValue } from "jotai";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { useEffect } from "react";
import { configureAnalytics } from "@/lib/analytics";

const PostHogProviderWrapper = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const enableContribution = useAtomValue(enableContributionAtom);

  useEffect(() => {
    return configureAnalytics(enableContribution);
  }, [enableContribution]);

  if (enableContribution === false) return <>{children}</>;

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
};

export default PostHogProviderWrapper;
