'use strict';
const U = [
  'photo-1522708323590-d24dbb6b0267',
  'photo-1502672260266-1c1ef2d93688',
  'photo-1560448204-e02f11c3d0e2',
  'photo-1505693416388-ac5ce068fe85',
  'photo-1484154218962-a197022b5858',
  'photo-1493809842364-78817add7ffb',
];
const img = (i) => `https://images.unsplash.com/${U[i % U.length]}?auto=format&fit=crop&w=800&q=60`;

const ROOMS = [
  ['Soweto (Orlando East)', 'Gauteng', 1200, 1200, 'Backroom', ['Water', 'Electricity', 'Shared Toilet'], 'Anyone', 'Thandi', 2, 14, 'Neat backroom in a safe yard, close to taxis and Orlando Stadium. Prepaid electricity. Quiet tenants only.'],
  ['Mamelodi East', 'Gauteng', 1500, 1500, 'Room in House', ['Water', 'Electricity', 'WiFi', 'Kitchen'], 'Female', 'Sipho', 1, 3, 'Room in a family house. Shared kitchen and WiFi included. 5 min walk to the bus stop.'],
  ['Tembisa (Ivory Park)', 'Gauteng', 900, 900, 'Sharing', ['Water', 'Shared Toilet'], 'Male', 'Jabu', 1, 6, 'Share a spacious room with one other working guy. Close to Tembisa Hospital and the taxi rank.'],
  ['Soshanguve (Block F)', 'Gauteng', 1100, 1100, 'Backroom', ['Water', 'Electricity', 'Private Toilet'], 'Anyone', 'Grace', 3, 22, 'Private backroom with own toilet. Gate locks at night. Near Soshanguve Crossing mall.'],
  ['Mbombela (Nelspruit)', 'Mpumalanga', 2000, 2000, 'Flat', ['Water', 'WiFi', 'Private Toilet', 'Kitchen', 'Parking'], 'Anyone', 'Johan', 3, 31, 'Bachelor flat with kitchenette and parking. Walking distance to Riverside Mall.'],
  ['KaNyamazane', 'Mpumalanga', 950, 950, 'Room in House', ['Water', 'Electricity', 'Shared Toilet'], 'Female', 'Nomsa', 2, 9, 'Quiet room in a house with a lovely gogo. Perfect for a working lady or student.'],
  ['Durban (Umlazi V Section)', 'KwaZulu-Natal', 1300, 1300, 'Backroom', ['Water', 'Electricity', 'Private Toilet'], 'Anyone', 'Zanele', 1, 2, 'Clean backroom with its own entrance. Taxis to town every 5 minutes.'],
  ['Pinetown', 'KwaZulu-Natal', 1800, 1800, 'Flat', ['Water', 'Electricity', 'WiFi', 'Kitchen', 'Furnished'], 'Anyone', 'Kevin', 2, 11, 'Furnished 1-bedroom flat near Pinetown CBD. Secure complex with access control.'],
  ['Pietermaritzburg CBD', 'KwaZulu-Natal', 1600, 1600, 'Student Room', ['Water', 'Electricity', 'WiFi', 'Furnished'], 'Anyone', 'Priya', 3, 18, 'Student room near the university campus. Desk, bed and cupboard included.'],
  ['Khayelitsha (Site C)', 'Western Cape', 1000, 1000, 'Backroom', ['Water', 'Electricity', 'Shared Toilet'], 'Anyone', 'Vuyo', 1, 4, 'Backroom close to the Site C train station. Cape Town CBD in about 40 minutes by train.'],
  ['Mitchells Plain', 'Western Cape', 2200, 2200, 'Room in House', ['Water', 'Electricity', 'WiFi', 'Kitchen', 'Parking'], 'Female', 'Fatima', 2, 7, 'Spacious room in a family home. Use of the kitchen and lounge. Safe street.'],
  ['Polokwane (Seshego)', 'Limpopo', 1400, 1400, 'Flat', ['Water', 'Electricity', 'Private Toilet', 'Kitchen'], 'Anyone', 'Tshepo', 1, 5, 'Tidy flat on a quiet street, 10 minutes from Polokwane CBD.'],
];

function seedDemo(store) {
  const { db, nextId } = store;
  ROOMS.forEach((r, i) => {
    const id = nextId('listings');
    db.listings.push({
      id,
      fullName: r[7],
      phone: '27710000000', 
      prov: r[1],
      area: r[0],
      street: '',
      price: r[2],
      dep: r[3],
      type: r[4],
      inc: r[5],
      for: r[6],
      desc: r[10],
      photos: [img(id), img(id + 1), img(id + 2), img(id + 3)],
      v: r[8],
      roomsRented: r[9],
      status: 'approved',
      hidden: false,
      flagged: false,
      demo: true,
      createdAt: new Date(Date.UTC(2025, 5, 1 + i, 8, 0, 0)).toISOString(),
    });
  });
}

module.exports = { seedDemo };
