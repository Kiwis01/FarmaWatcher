export interface SafetyCheckRequest { drugs: string[] }
export interface RecallHit { recallId: string; classification: 'I'|'II'|'III'; reason: string; status: string; sourceUrl: string }
export interface InteractionHit { pair: [string, string]; severity: string; description: string; sourceUrl: string }
export interface SafetyReport {
  drugs: { input: string; rxcui: string | null; activeRecalls: RecallHit[] }[]
  interactions: InteractionHit[]
  sources: string[]            // URLs de provenance
  generatedAt: string
  disclaimer: string
}
export interface Bulletin { slug: string; title: string; body: string; tags: string[]; provenance: { url: string; publishedAt: string }[] }

// Contrato A → B (A la implementa en packages/rxnorm+sources; B la consume en apps/api)
export type CheckDrugSafety = (req: SafetyCheckRequest) => Promise<SafetyReport>

// Contrato B → A (B la implementa en packages/publisher; A la consume en apps/worker)
export type PublishBulletin = (b: Bulletin) => Promise<{ url: string }>
