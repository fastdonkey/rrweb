declare const __DATAINSIGHTS_SDK_VERSION__: string;
declare const __DATAINSIGHTS_RRWEB_VERSION__: string;
declare const __DATAINSIGHTS_RRWEB_COMMIT__: string;

export const BUILD_INFO = Object.freeze({
  sdkVersion:
    typeof __DATAINSIGHTS_SDK_VERSION__ === 'undefined'
      ? '0.1.0'
      : __DATAINSIGHTS_SDK_VERSION__,
  rrwebVersion:
    typeof __DATAINSIGHTS_RRWEB_VERSION__ === 'undefined'
      ? '2.2.0'
      : __DATAINSIGHTS_RRWEB_VERSION__,
  rrwebCommit:
    typeof __DATAINSIGHTS_RRWEB_COMMIT__ === 'undefined'
      ? 'development'
      : __DATAINSIGHTS_RRWEB_COMMIT__,
});
