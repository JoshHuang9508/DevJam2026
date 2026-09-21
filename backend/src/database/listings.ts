import Database from "better-sqlite3";

type Mode = "sale" | "rent";

export function createListingsDatabase(path: string) {
  const query = <T>(run: (db: Database.Database) => T): T => {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try {
      return run(db);
    } finally {
      db.close();
    }
  };

  return {
    available() {
      try {
        query((db) => db.prepare("SELECT 1 FROM listings LIMIT 1").get());
        return true;
      } catch {
        return false;
      }
    },
    pool(mode: Mode, cities: string[]) {
      const args: string[] = [mode];
      let sql = "SELECT l.*, f.* FROM listings l INNER JOIN listing_features f ON l.id = f.listing_id WHERE l.mode = ?";
      if (cities.length) {
        sql += ` AND l.city IN (${cities.map(() => "?").join(",")})`;
        args.push(...cities);
      }
      return query((db) => db.prepare(sql).all(...args));
    },
    rows(mode: Mode) {
      return query((db) => db.prepare("SELECT city, district, price, area FROM listings WHERE mode = ?").all(mode));
    },
    districts() {
      return query((db) => db.prepare("SELECT d.city, d.name, d.centroid_lat AS lat, d.centroid_lng AS lng, COUNT(l.id) AS listing_count FROM districts d LEFT JOIN listings l ON l.city = d.city AND l.district = d.name GROUP BY d.id").all());
    },
  };
}
