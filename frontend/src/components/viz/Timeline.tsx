import type { JourneyEvent } from '../../lib/types'
import { TimelineEvent } from './TimelineEvent'
import { EmptyState } from '../feedback/EmptyState'

// Container cronologico — a ordenacao ja vem pronta do backend
// (crmJourneyService.ts ordena por `at` crescente antes de responder).
export function Timeline({ events }: { events: JourneyEvent[] }) {
  if (events.length === 0) return <EmptyState title="Nenhum evento com fonte disponivel." />

  return <ul className="panel enter p-5">{events.map((event, i) => <TimelineEvent key={`${event.type}-${event.reference}-${i}`} event={event} />)}</ul>
}
