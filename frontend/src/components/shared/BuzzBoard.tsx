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
  allowDirectSelect?: boolean
  emptyHint?: string
  selectingHint?: string
  yourTurnHint?: string
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
        <span className="board-tile-points">{tile.points}</span>
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
  allowDirectSelect = false,
  emptyHint,
  selectingHint,
  yourTurnHint,
}: BuzzBoardProps) {
  const isSelector = selectingPlayerId != null && viewerPlayerId === selectingPlayerId
  const canSelect = (allowDirectSelect || isSelector) && isWaiting

  if (!isWaiting || columns.length === 0) return null

  return (
    <div className="buzz-board">
      <div
        className="buzz-board-columns"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(11rem, 1fr))` }}
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
          <span className="board-selector-you">{yourTurnHint ?? 'Pick a question above!'}</span>
        ) : allowDirectSelect ? (
          <span className="board-selector-you">{yourTurnHint ?? 'Pick a question above!'}</span>
        ) : selectingPlayerId != null && selectorName ? (
          <span>{selectingHint ?? `${selectorName} is selecting...`}</span>
        ) : (
          <span style={{ color: 'var(--muted)' }}>{emptyHint ?? 'Waiting for host to assign a selector'}</span>
        )}
      </div>
    </div>
  )
}
