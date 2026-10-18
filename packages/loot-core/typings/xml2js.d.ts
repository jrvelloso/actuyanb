declare module 'xml2js' {
  export function parseStringPromise(
    value: string,
    options?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}
