import dotenv from "dotenv";
dotenv.config({ path: "./.env" });
import Redis from "ioredis";

const DEFAULT_TTL = 3600; // 1 hour

const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
   lazyConnect: true,
   enableOfflineQueue: false,
   maxRetriesPerRequest: 1,
});

let isConnected = false;

redis.on("connect", () => {
   isConnected = true;
   console.log("[Cache] Redis connected");
});

redis.on("error", (err) => {
   isConnected = false;
   console.warn("[Cache] Redis error (non-fatal):", err.message);
});

redis.on("close", () => {
   isConnected = false;
});

redis.connect().catch(() => {});

export async function get(key) {
   if (!isConnected) return null;
   try {
      const raw = await redis.get(key);
      return raw ? JSON.parse(raw) : null;
   } catch {
      return null;
   }
}

export async function set(key, value, ttl = DEFAULT_TTL) {
   if (!isConnected) return;
   try {
      await redis.set(key, JSON.stringify(value), "EX", ttl);
   } catch (err) {
      console.warn(`[Cache] SET failed for key=${key}:`, err.message);
   }
}

export async function del(...keys) {
   if (!isConnected) return;
   try {
      if (keys.length) await redis.del(...keys);
   } catch (err) {
      console.warn(`[Cache] DEL failed for keys=${keys.join(",")}:`, err.message);
   }
}

export async function flush(pattern) {
   if (!isConnected) return;
   try {
      let cursor = "0";
      do {
         const [nextCursor, keys] = await redis.scan(
            cursor,
            "MATCH",
            pattern,
            "COUNT",
            100
         );
         cursor = nextCursor;
         if (keys.length) {
            await redis.del(...keys);
         }
      } while (cursor !== "0");
   } catch (err) {
      console.warn(`[Cache] FLUSH failed for pattern=${pattern}:`, err.message);
   }
}