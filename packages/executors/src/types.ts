export type DriverContext = {
  driverName?: string;
  allowlist?: string[];
  limits?: {
    timeout_ms?: number;
    max_data_size?: number;
  };
  bindings?: any;
};

export type Driver = {
  execute(input: any, context?: DriverContext): Promise<any>;
};

export type DriverFactory = () => Driver;
