const dataInsightsFacade = Object.freeze({});

export const DataInsights = dataInsightsFacade;

export function createDataInsights(): typeof DataInsights {
  return dataInsightsFacade;
}
