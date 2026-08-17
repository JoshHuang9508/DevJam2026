import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const listings = sqliteTable('listings', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  sourceId: text('source_id').notNull(),
  mode: text('mode', { enum: ['sale', 'rent'] }).notNull(),
  url: text('url').notNull(),
  title: text('title').notNull(),
  scrapedAt: integer('scraped_at').notNull(),
  city: text('city').notNull(),
  district: text('district').notNull(),
  address: text('address').notNull(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  price: real('price').notNull(),
  unitPrice: real('unit_price').notNull(),
  area: real('area').notNull(),
  layout: text('layout').notNull(),
  rooms: integer('rooms').notNull(),
  floor: integer('floor').notNull(),
  totalFloor: integer('total_floor').notNull(),
  age: real('age').notNull(),
  buildingType: text('building_type').notNull(),
  hasElevator: integer('has_elevator', { mode: 'boolean' }).notNull(),
  hasParking: integer('has_parking', { mode: 'boolean' }).notNull(),
}, (t) => [
  index('idx_listings_mode_city').on(t.mode, t.city),
  index('idx_listings_district').on(t.district),
])

export const listingFeatures = sqliteTable('listing_features', {
  listingId: text('listing_id').primaryKey().references(() => listings.id),

  annualTemp: real('annual_temp'),
  summerTemp: real('summer_temp'),
  winterTemp: real('winter_temp'),
  rainDays: real('rain_days'),
  humidity: real('humidity'),
  sunHours: real('sun_hours'),
  aqiMean: real('aqi_mean'),

  poiConvenience500: integer('poi_convenience_500'),
  poiConvenience1k: integer('poi_convenience_1k'),
  poiSupermarket500: integer('poi_supermarket_500'),
  poiSupermarket1k: integer('poi_supermarket_1k'),
  poiSchool500: integer('poi_school_500'),
  poiSchool1k: integer('poi_school_1k'),
  poiHospital500: integer('poi_hospital_500'),
  poiHospital1k: integer('poi_hospital_1k'),
  poiPark500: integer('poi_park_500'),
  poiPark1k: integer('poi_park_1k'),
  poiRestaurant500: integer('poi_restaurant_500'),
  poiRestaurant1k: integer('poi_restaurant_1k'),

  distToMetro: real('dist_to_metro'),
  distToTrain: real('dist_to_train'),
  distToBus: real('dist_to_bus'),
  commuteToCbdMin: real('commute_to_cbd_min'),

  districtMedianUnitPrice: real('district_median_unit_price'),
  pricePercentile: real('price_percentile'),

  distToMainRoad: real('dist_to_main_road'),
  distToRail: real('dist_to_rail'),

  // 災害。pipeline 一直有算，之前沒有欄位可放就丟掉了。
  /** 500 公尺內近五年的實際淹水災點數（NCDR）。0 代表查過但附近沒有。 */
  floodIncidents500: integer('flood_incidents_500'),
  /** 土壤液化潛勢 1 低 / 2 中 / 3 高。只有臺北市有圖資，其餘為 null＝未檢測。 */
  liquefactionLevel: integer('liquefaction_level'),

  // 風水證據欄位。屬性名必須與 FengshuiFeatureKey 逐字相同，loadPool 才能整包當 ListingFeatures 用。
  // 旗標刻意用 integer() 而非 { mode: 'boolean' } —— fillDataGaps 要對缺值算中位數，
  // 那是數值運算；一旦轉成 boolean 就補不了值，也算不出 0..1 的小數風險。
  // 全部 nullable：null = 沒有格局圖／街景可辨識，屬「未檢測」，不等於「無虞」。
  fsEntryWindowAligned: integer('fs_entry_window_aligned'),
  fsEntryScreen: integer('fs_entry_screen'),
  fsStoveVisibleFromDoor: integer('fs_stove_visible_from_door'),
  fsToiletFacingDoor: integer('fs_toilet_facing_door'),
  fsBeamOverBed: integer('fs_beam_over_bed'),
  /** 客廳縱深（公尺），連續值故用 real() */
  fsLivingRoomDepthM: real('fs_living_room_depth_m'),
  fsDaylightBlocked: integer('fs_daylight_blocked'),
  fsRoadRush: integer('fs_road_rush'),
})

export const districts = sqliteTable('districts', {
  id: text('id').primaryKey(),
  city: text('city').notNull(),
  name: text('name').notNull(),
  centroidLat: real('centroid_lat').notNull(),
  centroidLng: real('centroid_lng').notNull(),
  /** GeoJSON Polygon 字串，choropleth 用；種子階段可為 null */
  boundary: text('boundary'),
})
