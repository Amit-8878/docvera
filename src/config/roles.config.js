/**
 * Master role + permission constants (ESM).
 * Merged with existing app roles: `super_admin` is used by the API alongside `admin`.
 */

export const ROLES = {
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
  USER: 'user',
  AGENT: 'agent',
  PARTNER: 'partner',
};

export const AGENT_TYPES = {
  BASIC: 'basic',
  PRO: 'pro',
  BUSINESS: 'business_partner',
};

export const PERMISSIONS = {
  ADMIN: {
    fullAccess: true,
  },

  SUPER_ADMIN: {
    fullAccess: true,
  },

  USER: {
    canOrder: true,
    canTrack: true,
    canBecomeAgent: true,
  },

  AGENT: {
    canAcceptOrders: true,
    canEarnCommission: true,
    canReferUsers: true,
    canHandleMultipleServices: true,
  },

  PARTNER: {
    canAcceptOrders: true,
    canEarnCommission: true,
    canReferUsers: true,
    canBuildTeam: true,
    canActAsBusinessPartner: true,
  },
};
