declare module "humanoid-js" {
  interface HumanoidInstance {
    sendRequest(
      url: string,
      method?: string,
      data?: object,
      headers?: object,
      dataType?: string,
    ): Promise<{ body: string }>;
  }

  export default class Humanoid {
    constructor(autoBypass?: boolean);
    sendRequest(
      url: string,
      method?: string,
      data?: object,
      headers?: object,
      dataType?: string,
    ): Promise<{ body: string }>;
  }
}
