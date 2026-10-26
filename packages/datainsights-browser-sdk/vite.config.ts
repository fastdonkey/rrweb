import path from 'node:path';

import config from '../../vite.config.default';

export default config(path.resolve(__dirname, 'src/index.ts'), 'DataInsights', {
  fileName: 'datainsights-browser-sdk',
});
