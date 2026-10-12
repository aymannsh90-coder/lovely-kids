import AsyncStorage from "@react-native-async-storage/async-storage";

export const ANALYTICS_VISITOR_ID_KEY =
  "lovely_kids_analytics_visitor_id";

let visitorIdPromise:
  Promise<string> | null =
  null;

function createVisitorId() {
  const cryptoObject =
    globalThis.crypto as
      | {
          randomUUID?: () => string;
        }
      | undefined;

  if (
    cryptoObject?.randomUUID
  ) {
    return cryptoObject
      .randomUUID()
      .replace(/-/g, "_");
  }

  return [
    "lk",
    Date.now().toString(36),
    Math.random()
      .toString(36)
      .slice(2),
    Math.random()
      .toString(36)
      .slice(2),
  ].join("_");
}

export async function getOrCreateAnalyticsVisitorId() {
  if (visitorIdPromise) {
    return visitorIdPromise;
  }

  visitorIdPromise =
    (async () => {
      const existing =
        await AsyncStorage.getItem(
          ANALYTICS_VISITOR_ID_KEY,
        );

      if (existing) {
        return existing;
      }

      const created =
        createVisitorId();

      await AsyncStorage.setItem(
        ANALYTICS_VISITOR_ID_KEY,
        created,
      );

      return created;
    })();

  try {
    return await visitorIdPromise;
  } finally {
    visitorIdPromise =
      null;
  }
}
