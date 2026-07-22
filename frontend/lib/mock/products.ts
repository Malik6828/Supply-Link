import type { Product, TrackingEvent, ProductAssembly, WarrantyInfo, WarrantyClaim } from '@/lib/types';

export const MOCK_PRODUCTS: Product[] = [
  {
    id: 'prod-001',
    name: 'Organic Coffee Beans',
    origin: 'Ethiopia',
    owner: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    timestamp: 1710000000000,
    active: true,
    authorizedActors: [
      'GACTOR1ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567',
      'GACTOR2ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567',
    ],
    ownershipHistory: [
      { owner: 'GORIGINALOWNERABCDEFGHIJKLMNOPQRSTUVWXYZ', transferredAt: 1700000000000 },
      { owner: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ', transferredAt: 1710000000000 },
    ],
    category: 'agricultural',
    subcategory: 'coffee',
    certifications: [
      {
        id: 'cert-001-organic',
        productId: 'prod-001',
        certType: 'organic',
        issuer: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        issuedAt: 1710100000000,
        revoked: false,
      },
      {
        id: 'cert-001-fair-trade',
        productId: 'prod-001',
        certType: 'fair_trade',
        issuer: 'GACTOR1ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567',
        issuedAt: 1710150000000,
        revoked: false,
      },
    ],
    // Warranty: 2-year warranty on the coffee batch
    warranty: {
      productId: 'prod-001',
      durationSeconds: 2 * 365 * 24 * 3600,
      issuer: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      issuedAt: 1710000000000,
      terms: 'Quality guarantee: full refund if product does not meet grade specifications.',
      termsRef: 'ipfs://QmWarrantyDocCoffeeBeans001',
      voided: false,
      voidedAt: 0,
    },
    warrantyClaims: [],
  },
  {
    id: 'prod-002',
    name: 'Fair Trade Cocoa',
    origin: 'Ghana',
    owner: 'GDEF1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    timestamp: 1711000000000,
    active: true,
    authorizedActors: ['GACTOR3ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567'],
    ownershipHistory: [
      { owner: 'GDEF1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ', transferredAt: 1711000000000 },
    ],
    category: 'agricultural',
    subcategory: 'cocoa',
    certifications: [
      {
        id: 'cert-002-fair-trade',
        productId: 'prod-002',
        certType: 'fair_trade',
        issuer: 'GDEF1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        issuedAt: 1711100000000,
        revoked: false,
      },
      {
        id: 'cert-002-rainforest',
        productId: 'prod-002',
        certType: 'rainforest_alliance',
        issuer: 'GACTOR3ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567',
        issuedAt: 1711200000000,
        revoked: false,
      },
    ],
    // No warranty on cocoa batch
  },
  {
    id: 'prod-003',
    name: 'Premium Chocolate Bar',
    origin: 'Belgium',
    owner: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    timestamp: 1712000000000,
    active: true,
    authorizedActors: [
      'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      'GACTOR1ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567',
    ],
    ownershipHistory: [
      { owner: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ', transferredAt: 1712000000000 },
    ],
    category: 'food',
    subcategory: 'confectionery',
    certifications: [],
    // Assembly: chocolate bar is assembled from coffee beans + cocoa
    assembly: {
      parentId: 'prod-003',
      componentIds: ['prod-001', 'prod-002'],
      registeredBy: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      registeredAt: 1712100000000,
      description:
        'Premium chocolate bar assembled from Ethiopian organic coffee beans and Ghanaian fair-trade cocoa.',
    },
    // Warranty: 1-year product warranty
    warranty: {
      productId: 'prod-003',
      durationSeconds: 365 * 24 * 3600,
      issuer: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      issuedAt: 1712000000000,
      terms:
        'Manufacturer warranty: replacement or refund for defective products within 1 year of purchase.',
      termsRef: 'ipfs://QmWarrantyDocChocolateBar003',
      voided: false,
      voidedAt: 0,
    },
    warrantyClaims: [
      {
        claimId: 'claim-003-001',
        productId: 'prod-003',
        claimant: 'GCUSTOMER1ABCDEFGHIJKLMNOPQRSTUVWXYZ123',
        filedAt: 1712500000000,
        description: 'Packaging was damaged on arrival. Product quality unaffected.',
        proofRef: 'ipfs://QmClaimProofDamagedPackaging',
        status: 'Resolved',
        updatedAt: 1712600000000,
      },
    ],
  },
];

export const MOCK_EVENTS: TrackingEvent[] = [
  {
    productId: 'prod-001',
    eventType: 'HARVEST',
    location: 'Yirgacheffe, Ethiopia',
    actor: 'GACTOR1ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567',
    timestamp: 1710000000000,
    metadata: JSON.stringify({
      notes: 'Hand-picked, shade-grown',
      lat: 6.1667,
      lng: 38.2,
      carbon_footprint: 8,
      certification_level: 'gold',
      sustainable_practices: ['shade_grown', 'hand_picked', 'water_conservation'],
      renewable_energy_pct: 85,
      recyclable_packaging: true,
    }),
  },
  {
    productId: 'prod-001',
    eventType: 'PROCESSING',
    location: 'Addis Ababa, Ethiopia',
    actor: 'GACTOR1ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567',
    timestamp: 1710200000000,
    metadata: JSON.stringify({
      method: 'Washed',
      moisture: '11%',
      lat: 9.0054,
      lng: 38.7636,
      carbon_footprint: 12,
      sustainable_practices: ['water_recycle'],
      renewable_energy_pct: 70,
    }),
  },
  {
    productId: 'prod-001',
    eventType: 'SHIPPING',
    location: 'Port of Djibouti',
    actor: 'GACTOR2ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567',
    timestamp: 1710400000000,
    metadata: JSON.stringify({
      vessel: 'MV Stellar',
      destination: 'Rotterdam',
      lat: 11.5892,
      lng: 43.1456,
      carbon_footprint: 45,
      sustainable_practices: ['low_sulfur_fuel'],
    }),
  },
  {
    productId: 'prod-001',
    eventType: 'RETAIL',
    location: 'Amsterdam, Netherlands',
    actor: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    timestamp: 1710600000000,
    metadata: JSON.stringify({
      store: 'Green Beans Co.',
      lat: 52.3676,
      lng: 4.9041,
      carbon_footprint: 5,
      recyclable_packaging: true,
      renewable_energy_pct: 100,
    }),
  },
  {
    productId: 'prod-002',
    eventType: 'HARVEST',
    location: 'Ashanti Region, Ghana',
    actor: 'GACTOR3ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567',
    timestamp: 1711000000000,
    metadata: JSON.stringify({
      variety: 'Forastero',
      lat: 6.6885,
      lng: -1.6244,
      carbon_footprint: 15,
      certification_level: 'silver',
      sustainable_practices: ['agroforestry', 'no_child_labor'],
      renewable_energy_pct: 50,
      recyclable_packaging: false,
    }),
  },
  // Events for the assembled chocolate bar (prod-003)
  {
    productId: 'prod-003',
    eventType: 'PROCESSING',
    location: 'Brussels, Belgium',
    actor: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    timestamp: 1712000000000,
    metadata: JSON.stringify({
      process: 'Conching and tempering',
      lat: 50.8503,
      lng: 4.3517,
      carbon_footprint: 20,
      sustainable_practices: ['renewable_energy'],
      renewable_energy_pct: 90,
      recyclable_packaging: true,
    }),
  },
  {
    productId: 'prod-003',
    eventType: 'SHIPPING',
    location: 'Port of Antwerp, Belgium',
    actor: 'GACTOR1ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567',
    timestamp: 1712200000000,
    metadata: JSON.stringify({
      vessel: 'MV Cocoa Star',
      destination: 'New York',
      lat: 51.2194,
      lng: 4.4025,
      carbon_footprint: 35,
      sustainable_practices: ['carbon_offset'],
    }),
  },
  {
    productId: 'prod-003',
    eventType: 'RETAIL',
    location: 'New York, USA',
    actor: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    timestamp: 1712400000000,
    metadata: JSON.stringify({
      store: 'Artisan Chocolates NYC',
      lat: 40.7128,
      lng: -74.006,
      carbon_footprint: 3,
      recyclable_packaging: true,
      renewable_energy_pct: 100,
    }),
  },
];

// ── E2E test seed product — recalled, inactive ────────────────────────────────

export const MOCK_RECALLED_PRODUCT: Product = {
  id: 'prod-recalled-e2e',
  name: 'Recalled Test Coffee',
  origin: 'Ethiopia',
  owner: 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  timestamp: 1710000000000,
  active: false,
  recalled: true,
  recallReason: 'Contamination detected during quality control inspection.',
  recallTimestamp: 1720000000,
  authorizedActors: [],
  ownershipHistory: [],
  category: 'agricultural',
  subcategory: 'coffee',
  certifications: [],
};

MOCK_PRODUCTS.push(MOCK_RECALLED_PRODUCT);

export function getProductById(id: string): Product | undefined {
  return MOCK_PRODUCTS.find((p) => p.id === id);
}

export function getAllProducts(): Product[] {
  return MOCK_PRODUCTS;
}

export function getEventsByProductId(id: string): TrackingEvent[] {
  return MOCK_EVENTS.filter((e) => e.productId === id);
}
