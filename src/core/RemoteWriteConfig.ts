/**
 * Configuration for the Prometheus remote-write endpoint.
 */
export interface RemoteWriteConfig {
  url: string;
  timeout: number; // milliseconds
  headers?: Record<string, string>;
}
