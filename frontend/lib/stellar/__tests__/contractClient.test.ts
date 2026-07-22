import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createContractClient,
  contractClient,
  LiveContractClient,
  MockContractClient,
  fetchEventPage,
  fetchAllEvents,
  fetchProvenancePath,
  fetchAuthPolicy,
} from '../contract';
import * as clientModule from '../client';
import { nativeToScVal, scValToNative } from '@stellar/stellar-sdk';

const VALID_ADDRESS = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFXYFRE6YOWNGUMT7BAGA';
const VALID_ADDRESS_2 = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA64PWBTRKZA';

vi.mock('@stellar/freighter-api', () => ({
  isConnected: vi.fn(async () => ({ isConnected: true })),
  getAddress: vi.fn(async () => ({
    address: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFXYFRE6YOWNGUMT7BAGA',
  })),
  signTransaction: vi.fn(async () => ({ signedTxXdr: 'AAAA_MOCK_SIGNED_XDR' })),
}));

vi.mock('@/lib/api/metrics', () => ({
  recordDependency: vi.fn(),
  recordOperation: vi.fn(),
}));

describe('ContractClient Invocation Architecture (#582)', () => {
  const originalEnv = process.env.NEXT_PUBLIC_USE_MOCK_CONTRACT;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_USE_MOCK_CONTRACT = 'true';
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_USE_MOCK_CONTRACT = originalEnv;
  });

  describe('Configuration Switching & Factory', () => {
    it('creates MockContractClient when useMock is true', () => {
      const client = createContractClient({ useMock: true });
      expect(client).toBeInstanceOf(MockContractClient);
    });

    it('creates LiveContractClient when useMock is false', () => {
      const client = createContractClient({ useMock: false });
      expect(client).toBeInstanceOf(LiveContractClient);
    });

    it('uses NEXT_PUBLIC_USE_MOCK_CONTRACT environment variable', () => {
      process.env.NEXT_PUBLIC_USE_MOCK_CONTRACT = 'true';
      expect(createContractClient()).toBeInstanceOf(MockContractClient);

      process.env.NEXT_PUBLIC_USE_MOCK_CONTRACT = 'false';
      expect(createContractClient()).toBeInstanceOf(LiveContractClient);
    });
  });

  describe('MockContractClient Behavior', () => {
    let mockClient: MockContractClient;

    beforeEach(() => {
      mockClient = new MockContractClient();
    });

    it('registers and retrieves a product', async () => {
      const txHash = await mockClient.registerProduct(
        'PROD-TEST-1',
        'Test Product',
        'Factory A',
        VALID_ADDRESS,
        VALID_ADDRESS,
      );
      expect(txHash).toMatch(/^mock_tx_register_PROD-TEST-1_/);

      const product = await mockClient.getProduct('PROD-TEST-1');
      expect(product).not.toBeNull();
      expect(product?.name).toBe('Test Product');
      expect(product?.owner).toBe(VALID_ADDRESS);
    });

    it('lists products with pagination', async () => {
      await mockClient.registerProduct('P1', 'Product 1', 'Origin 1', VALID_ADDRESS, VALID_ADDRESS);
      await mockClient.registerProduct(
        'P2',
        'Product 2',
        'Origin 2',
        VALID_ADDRESS_2,
        VALID_ADDRESS_2,
      );

      const res = await mockClient.listProducts(0, 10);
      expect(res.total).toBeGreaterThanOrEqual(2);
      expect(res.products.some((p) => p.id === 'P1')).toBe(true);
    });

    it('deactivates product and updates state', async () => {
      await mockClient.registerProduct(
        'P-DEACT',
        'Product Deact',
        'Origin',
        VALID_ADDRESS,
        VALID_ADDRESS,
      );
      await mockClient.deactivateProduct('P-DEACT', VALID_ADDRESS);

      const p = await mockClient.getProduct('P-DEACT');
      expect(p?.active).toBe(false);
    });

    it('transfers ownership of a product', async () => {
      await mockClient.registerProduct(
        'P-XFER',
        'Xfer Product',
        'Origin',
        VALID_ADDRESS,
        VALID_ADDRESS,
      );
      await mockClient.transferOwnership('P-XFER', VALID_ADDRESS_2, VALID_ADDRESS);

      const p = await mockClient.getProduct('P-XFER');
      expect(p?.owner).toBe(VALID_ADDRESS_2);
    });

    it('manages authorized actors', async () => {
      await mockClient.registerProduct(
        'P-ACTOR',
        'Actor Product',
        'Origin',
        VALID_ADDRESS,
        VALID_ADDRESS,
      );

      await mockClient.addAuthorizedActor('P-ACTOR', VALID_ADDRESS_2, VALID_ADDRESS);
      let p = await mockClient.getProduct('P-ACTOR');
      expect(p?.authorizedActors).toContain(VALID_ADDRESS_2);

      await mockClient.removeAuthorizedActor('P-ACTOR', VALID_ADDRESS_2, VALID_ADDRESS);
      p = await mockClient.getProduct('P-ACTOR');
      expect(p?.authorizedActors).not.toContain(VALID_ADDRESS_2);
    });

    it('adds and retrieves tracking events', async () => {
      const hash = await mockClient.addTrackingEvent(
        'P-EVT',
        'Warehouse 1',
        'SHIPPING',
        '{"temp":20}',
        VALID_ADDRESS,
      );
      expect(hash).toMatch(/^mock_tx_event_P-EVT_/);

      const events = await mockClient.getTrackingEvents('P-EVT');
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].location).toBe('Warehouse 1');
    });

    it('fetches paginated event pages and applies filters', async () => {
      await mockClient.addTrackingEvent('P-FILTER', 'Loc 1', 'SHIPPING', '', VALID_ADDRESS);
      await mockClient.addTrackingEvent('P-FILTER', 'Loc 2', 'PROCESSING', '', VALID_ADDRESS_2);

      const page = await mockClient.fetchEventPage('P-FILTER', 0, 10, { eventType: 'SHIPPING' });
      expect(page.events.every((e) => e.eventType === 'SHIPPING')).toBe(true);
    });

    it('fetches provenance path sorted by timestamp', async () => {
      const path = await mockClient.fetchProvenancePath('PROD-1');
      for (let i = 1; i < path.length; i++) {
        expect(path[i].timestamp).toBeGreaterThanOrEqual(path[i - 1].timestamp);
      }
    });

    it('handles document anchoring and verification', async () => {
      const hash = '0x123456789abcdef';
      await mockClient.anchorDocumentHash('P-DOC', 'Cert A', hash, VALID_ADDRESS);

      const isValid = await mockClient.verifyDocumentHash('P-DOC', hash);
      expect(isValid).toBe(true);

      const isInvalid = await mockClient.verifyDocumentHash('P-DOC', '0xbad');
      expect(isInvalid).toBe(false);
    });

    it('handles warranty lifecycle', async () => {
      await mockClient.registerWarranty(
        'P-WARN',
        86400,
        '1 Year Warranty',
        'ipfs://ref',
        VALID_ADDRESS,
      );

      let isActive = await mockClient.isWarrantyActive('P-WARN');
      expect(isActive).toBe(true);

      await mockClient.voidWarranty('P-WARN', VALID_ADDRESS);
      isActive = await mockClient.isWarrantyActive('P-WARN');
      expect(isActive).toBe(false);
    });
  });

  describe('ScVal Encoding & Decoding', () => {
    it('correctly encodes and decodes native JavaScript types to/from ScVal', () => {
      const strVal = 'hello_soroban';
      const scValStr = nativeToScVal(strVal);
      expect(scValToNative(scValStr)).toBe(strVal);

      const numVal = 42;
      const scValNum = nativeToScVal(numVal);
      expect(BigInt(scValToNative(scValNum))).toBe(42n);

      const boolVal = true;
      const scValBool = nativeToScVal(boolVal);
      expect(scValToNative(scValBool)).toBe(true);
    });
  });

  describe('LiveContractClient Behavior & Transaction Construction', () => {
    it('instantiates LiveContractClient with custom config', () => {
      const liveClient = new LiveContractClient({
        rpcUrl: 'https://custom-rpc.stellar.org',
        networkPassphrase: 'Custom Network',
        contractId: 'CCUSTOM123',
      });
      expect(liveClient).toBeInstanceOf(LiveContractClient);
    });
  });

  describe('Public Interface Consistency & Client Delegation', () => {
    it('delegates top-level contract functions in contract.ts to contractClient', async () => {
      const page = await fetchEventPage('PROD-1', 0, 5);
      expect(page.events).toBeDefined();

      const all = await fetchAllEvents('PROD-1');
      expect(all).toBeDefined();

      const path = await fetchProvenancePath('PROD-1');
      expect(path).toBeDefined();

      const policy = await fetchAuthPolicy('PROD-1');
      expect(policy.threshold).toBe(1);
    });

    it('delegates client.ts helper functions directly to contractClient without stubs', async () => {
      const tx = await clientModule.registerProduct(
        'P-CLIENT',
        'Name',
        'Origin',
        'Desc',
        VALID_ADDRESS,
      );
      expect(typeof tx).toBe('string');

      const products = await clientModule.listProducts(0, 5);
      expect(products.products).toBeDefined();

      await clientModule.transferOwnership('P-CLIENT', VALID_ADDRESS_2, VALID_ADDRESS);
      await clientModule.addAuthorizedActor('P-CLIENT', VALID_ADDRESS_2, VALID_ADDRESS);
      await clientModule.removeAuthorizedActor('P-CLIENT', VALID_ADDRESS_2, VALID_ADDRESS);
    });

    it('maintains parity between MockContractClient and contractClient interface methods', async () => {
      const mock = new MockContractClient();
      const methods: Array<keyof typeof mock> = [
        'registerProduct',
        'getProduct',
        'listProducts',
        'getProductCount',
        'addTrackingEvent',
        'getTrackingEvents',
        'fetchEventPage',
        'fetchAllEvents',
        'fetchProvenancePath',
        'fetchAuthPolicy',
        'anchorDocumentHash',
        'verifyDocumentHash',
      ];

      for (const m of methods) {
        expect(typeof mock[m]).toBe('function');
        expect(typeof contractClient[m]).toBe('function');
      }
    });
  });
});
