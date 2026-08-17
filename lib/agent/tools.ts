import { Type, type FunctionDeclaration } from '@google/genai'

export const UPDATE_PROFILE_FUNCTION_NAME = 'update_search_profile'

export const UPDATE_PROFILE_DECLARATION: FunctionDeclaration = {
  name: UPDATE_PROFILE_FUNCTION_NAME,
  description: '把使用者這次發言中的找房條件與權重「變動量」寫入。未提到的欄位一律省略。',
  parameters: {
    type: Type.OBJECT,
    properties: {
      mode: {
        type: Type.STRING,
        enum: ['sale', 'rent'],
        description: '使用者明確表示要買房或租房時才填',
      },
      weightsDelta: {
        type: Type.OBJECT,
        description: '各維度權重的增減，範圍 -100 到 100，一般用 10 到 30',
        properties: {
          price: { type: Type.NUMBER },
          value: { type: Type.NUMBER },
          weather: { type: Type.NUMBER },
          location: { type: Type.NUMBER },
          amenities: { type: Type.NUMBER },
          space: { type: Type.NUMBER },
          quality: { type: Type.NUMBER },
        },
      },
      hard: {
        type: Type.OBJECT,
        description: '硬性條件。只有使用者講出明確數字或地名時才填。',
        properties: {
          cities: { type: Type.ARRAY, items: { type: Type.STRING }, description: '例：臺北市、新北市' },
          districts: { type: Type.ARRAY, items: { type: Type.STRING }, description: '例：大安區、板橋區' },
          budgetMin: { type: Type.NUMBER, description: '買賣為萬元總價，租賃為元／月' },
          budgetMax: { type: Type.NUMBER, description: '買賣為萬元總價，租賃為元／月' },
          minArea: { type: Type.NUMBER, description: '最小坪數' },
          minRooms: { type: Type.NUMBER, description: '最少房間數' },
          maxAge: { type: Type.NUMBER, description: '屋齡上限，單位年' },
          buildingTypes: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '電梯大樓、公寓、華廈、透天厝、套房',
          },
          needElevator: { type: Type.BOOLEAN },
          needParking: { type: Type.BOOLEAN },
          maxDistToMetro: { type: Type.NUMBER, description: '離捷運距離上限，單位公尺' },
        },
      },
      soft: {
        type: Type.OBJECT,
        description: '軟性偏好，只調整分數不排除物件',
        properties: {
          prefersCool: { type: Type.BOOLEAN, description: '怕熱' },
          prefersLowRain: { type: Type.BOOLEAN, description: '討厭多雨' },
          prefersQuiet: { type: Type.NUMBER, description: '-1 到 1，正值偏好安靜' },
          commuteAnchor: {
            type: Type.OBJECT,
            description: '使用者上班或上學的地點',
            properties: {
              lat: { type: Type.NUMBER },
              lng: { type: Type.NUMBER },
              label: { type: Type.STRING },
              maxMin: { type: Type.NUMBER, description: '可接受的通勤分鐘數' },
            },
            required: ['lat', 'lng', 'label'],
          },
        },
      },
      note: { type: Type.STRING, description: '用一句話記下使用者這次的口語脈絡' },
    },
  },
}
