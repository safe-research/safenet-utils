import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import { useQuery } from "@tanstack/react-query"
import type { OracleConfig } from "@/config/oracle"

function validatedTxTemplate(template: string): string {
  try {
    const url = new URL(template.replaceAll("{{txHash}}", "0x0"))
    return template.includes("{{txHash}}") && url.protocol === "https:" ? template : ""
  } catch {
    return ""
  }
}

/** Reads optional link metadata without using it as authorization or case evidence. */
export function useChainInfo(sdk: SafeAppsSDK, config: OracleConfig) {
  return useQuery({
    queryKey: ["chainInfo", config.chainId],
    queryFn: async () => {
      const chain = await sdk.safe.getChainInfo()
      if (chain.chainId !== String(config.chainId)) {
        throw new Error("Safe Wallet returned metadata for a different chain")
      }
      return {
        ...chain,
        blockExplorerUriTemplate: {
          ...chain.blockExplorerUriTemplate,
          txHash: validatedTxTemplate(chain.blockExplorerUriTemplate.txHash),
        },
      }
    },
    retry: false,
    staleTime: Infinity,
  })
}
