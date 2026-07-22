import { StateCreator } from 'zustand';
import { SupplyLinkStore, ProductsSlice } from './types';
import { productKey } from './keys';

export const createProductsSlice: StateCreator<SupplyLinkStore, [], [], ProductsSlice> = (set) => ({
  productsById: {},
  productOrder: [],
  productsStatus: { state: 'idle' },
  productsLastFetched: null,
  productPage: 0,
  productPageSize: 20,
  productTotal: 0,

  setProducts: (products) =>
    set({
      productsById: Object.fromEntries(products.map((p) => [productKey(p), p])),
      productOrder: products.map(productKey),
    }),

  addProduct: (product) =>
    set((s) => {
      const key = productKey(product);
      const isNew = !(key in s.productsById);
      return {
        productsById: { ...s.productsById, [key]: product },
        productOrder: isNew ? [...s.productOrder, key] : s.productOrder,
      };
    }),

  setProductsStatus: (productsStatus) => set({ productsStatus }),
  setProductsLastFetched: (productsLastFetched) => set({ productsLastFetched }),

  updateProductOwner: (productId, newOwner) =>
    set((s) => {
      const existing = s.productsById[productId];
      if (!existing) return s;
      return {
        productsById: { ...s.productsById, [productId]: { ...existing, owner: newOwner } },
      };
    }),

  addOptimisticProduct: (product) =>
    set((s) => {
      const key = productKey(product);
      const isNew = !(key in s.productsById);
      return {
        productsById: { ...s.productsById, [key]: { ...product, pending: true } },
        productOrder: isNew ? [...s.productOrder, key] : s.productOrder,
      };
    }),

  confirmOptimisticProduct: (productId) =>
    set((s) => {
      const existing = s.productsById[productId];
      if (!existing) return s;
      return {
        productsById: { ...s.productsById, [productId]: { ...existing, pending: false } },
      };
    }),

  removeOptimisticProduct: (productId) =>
    set((s) => {
      if (!(productId in s.productsById)) return s;
      const { [productId]: _removed, ...rest } = s.productsById;
      return {
        productsById: rest,
        productOrder: s.productOrder.filter((id) => id !== productId),
      };
    }),

  setProductPage: (productPage) => set({ productPage }),
  setProductPageSize: (productPageSize) => set({ productPageSize }),
  setProductTotal: (productTotal) => set({ productTotal }),
});
