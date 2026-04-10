import type { BoardColumn, BoardTile } from '../../types'

interface BuzzBoardProps {
  columns: BoardColumn[]
  answeredIds: number[]
  selectingPlayerId: number | null
  viewerPlayerId: number | null
  viewerScore: number
  onSelectTile?: (tileId: number) => void
  isWaiting: boolean
  selectorName?: string
}

function SpecialBadge({ type }: { type: string }) {
  if (type === 'cat_in_bag') return <span className="board-tile-badge cib">CiB</span>
  if (type === 'stakes') return <span className="board-tile-badge stakes">$</span>
  return null
}

function Tile({
  tile,
  answered,
  canSelect,
  onSelect,
}: {
  tile: BoardTile
  answered: boolean
  canSelect: boolean
  onSelect: () => void
}) {
  return (
    <button
      className={`board-tile${answered ? ' answered' : ''}${canSelect && !answered ? ' selectable' : ''}`}
      disabled={answered || !canSelect}
      onClick={canSelect && !answered ? onSelect : undefined}
      type="button"
    >
      {answered ? (
        <span className="board-tile-done">OK</span>
      ) : (
        <>
          <span className="board-tile-points">{tile.points}</span>
          <SpecialBadge type={tile.specialType} />
        </>
      )}
    </button>
  )
}

export function BuzzBoard({
  columns,
  answeredIds,
  selectingPlayerId,
  viewerPlayerId,
  onSelectTile,
  isWaiting,
  selectorName,
}: BuzzBoardProps) {
  const isSelector = selectingPlayerId != null && viewerPlayerId === selectingPlayerId
  const canSelect = isSelector && isWaiting

  if (!isWaiting || columns.length === 0) return null

  return (
    <div className="buzz-board">
      <div
        className="buzz-board-columns"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
      >
        {columns.map((column) => (
          <div className="buzz-board-column" key={column.name}>
            <div className="buzz-board-col-header">{column.name}</div>
            {column.tiles.map((tile) => (
              <Tile
                answered={answeredIds.includes(tile.id)}
                canSelect={canSelect}
                key={tile.id}
                onSelect={() => onSelectTile?.(tile.id)}
                tile={tile}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="board-selector-hint">
        {isSelector ? (
          <span className="board-selector-you">Pick a question above!</span>
        ) : selectingPlayerId != null && selectorName ? (
          <span>{selectorName} is selecting...</span>
        ) : (
          <span style={{ color: 'var(--muted)' }}>Waiting for host to assign a selector</span>
        )}
      </div>
    </div>
  )
}
