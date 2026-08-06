// Auto-typed adapter config — mirror of io-package.json "native".
// Extended as the configuration grows (OAuth client credentials, language).

declare global {
  namespace ioBroker {
    interface AdapterConfig {
      /** Home Connect developer application client ID. */
      clientID: string;
      /** Home Connect developer application client secret (encrypted native). */
      clientSecret: string;
      /** Accept-Language sent to the BSH API for localized names; empty = use system language. */
      language: string;
    }
  }
}

export {};
