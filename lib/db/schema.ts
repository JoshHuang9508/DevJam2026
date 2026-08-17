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
