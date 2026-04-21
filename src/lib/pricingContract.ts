export type PricingItemInput = {
  id: string
  text: string
  quantity: number
  unit: string
}

export type PricingEstimateRequest = {
  storeSlug: string | null
  items: PricingItemInput[]
  currency?: 'AUD'
}

export type PricingItemEstimate = {
  itemId: string
  estimatedCost: number
  regularEstimatedCost?: number
  onSpecial: boolean
  confidence: 'high' | 'medium' | 'low'
  source: string
}

export type PricingEstimateResponse = {
  currency: 'AUD'
  items: PricingItemEstimate[]
  totalEstimatedCost: number
  generatedAt: string
  sourceLabel: string
}
