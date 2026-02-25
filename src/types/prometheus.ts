/**
 * Internal Prometheus remote-write data structures.
 * These map directly to the protobuf WriteRequest schema.
 */

export interface Label {
  name: string;
  value: string;
}

export interface Sample {
  value: number;
  timestamp: bigint; // milliseconds since epoch
}

export interface TimeSeries {
  labels: Label[]; // must be sorted alphabetically by name
  samples: Sample[];
}

export interface WriteRequest {
  timeseries: TimeSeries[];
}
