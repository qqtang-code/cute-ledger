import { barRatios, donutSlices, type CategorySlice } from '../../domain/stats'
import { formatCents } from '../../domain/money'
import type { Category } from '../../domain/types'

interface DonutProps {
  slices: CategorySlice[]
  categories: Category[]
  symbol: string
  size?: number
}

/** 手写 SVG 环形图（不引图表库，手机包体小；ARCHITECTURE.md 明令不许引） */
export function DonutChart({ slices, categories, symbol, size = 168 }: DonutProps) {
  const radius = size / 2
  const thickness = Math.max(18, Math.round(size * 0.16))
  const arcs = donutSlices(slices, radius, thickness)
  const total = slices.reduce((sum, s) => sum + s.totalCents, 0)

  if (total <= 0) {
    return (
      <p className="dim center" data-testid="donut-empty">
        这段时间还没有支出
      </p>
    )
  }

  return (
    <div className="donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="分类占比环形图">
        {arcs.map((arc) => {
          const category = categories.find((c) => c.id === arc.categoryId)
          return (
            <path
              key={arc.categoryId}
              d={arc.path}
              fill={category?.color ?? 'var(--c-primary)'}
              data-testid="donut-slice"
            />
          )
        })}
      </svg>
      <div className="donut__legend">
        {slices.map((slice) => {
          const category = categories.find((c) => c.id === slice.categoryId)
          return (
            <div className="legend-row" key={slice.categoryId} data-testid="legend-row">
              <span className="legend-row__dot" style={{ background: category?.color ?? 'var(--c-primary)' }} />
              <span className="legend-row__name">
                {category?.emoji ?? '📦'} {category?.name ?? '未分类'}
              </span>
              <span className="legend-row__value">
                {formatCents(slice.totalCents, symbol)}
                <span className="dim"> · {Math.round(slice.ratio * 100)}%</span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface BarChartProps {
  data: Array<{ date: string; totalCents: number }>
  symbol: string
  onPick?: (date: string) => void
}

/** 手写 SVG 柱状图；点某天可以跳到那天的流水 */
export function BarChart({ data, symbol, onPick }: BarChartProps) {
  const values = data.map((d) => d.totalCents)
  const ratios = barRatios(values)
  const height = 120
  const barWidth = data.length > 0 ? Math.max(3, Math.min(18, Math.floor(280 / data.length))) : 8
  const width = Math.max(280, data.length * (barWidth + 4))

  if (data.length === 0) return <p className="dim center">没有数据</p>

  return (
    <div className="bar-chart">
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="每日支出柱状图">
        {data.map((item, index) => {
          const barHeight = Math.max(ratios[index] > 0 ? 3 : 1, Math.round(ratios[index] * (height - 10)))
          return (
            <rect
              key={item.date}
              x={index * (barWidth + 4)}
              y={height - barHeight}
              width={barWidth}
              height={barHeight}
              rx={Math.min(4, barWidth / 2)}
              fill={item.totalCents > 0 ? 'var(--c-primary)' : 'var(--c-border)'}
              data-testid="bar"
              onClick={() => onPick?.(item.date)}
            >
              <title>{`${item.date}：${formatCents(item.totalCents, symbol)}`}</title>
            </rect>
          )
        })}
      </svg>
      <div className="bar-chart__axis dim">
        <span>{data[0]?.date.slice(5)}</span>
        <span>{data[data.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  )
}