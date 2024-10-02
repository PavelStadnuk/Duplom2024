import React, { useCallback, useEffect, useState } from 'react'
import {
	CartesianGrid,
	Legend,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts'
import './style/salesForecast.css'

type DataPoint = {
	period: number
	value: number
	movingAverage?: number
	centeredMovingAverage?: number
	deviationFromMovingAverage?: number
	seasonalComponent?: number
	averageSeasonalComponent?: number
	adjustedSeasonalComponent?: number
	trend?: number
	seasonal?: number
	tPlusSeasonal?: number
	error?: number
	errorSquared?: number
	deseasonalized?: number
	forecast?: number
}

type Model = 'additive' | 'multiplicative'

const SalesForecast: React.FC = () => {
	const [data, setData] = useState<DataPoint[]>([])
	const [forecastPeriods, setForecastPeriods] = useState<number>(0)
	const [model, setModel] = useState<Model>('additive')
	const [inputValue, setInputValue] = useState<string>('')
	const [movingAverageTable, setMovingAverageTable] = useState<DataPoint[]>([])
	const [seasonalComponents, setSeasonalComponents] = useState<DataPoint[]>([])
	const [modelTable, setModelTable] = useState<DataPoint[]>([])
	const [forecastData, setForecastData] = useState<DataPoint[]>([])
	const [activeTab, setActiveTab] = useState<string>('moving-average')

	const handleAddDataPoint = useCallback(() => {
		const value = parseFloat(inputValue)
		if (!isNaN(value)) {
			setData(prevData => [...prevData, { period: prevData.length + 1, value }])
			setInputValue('')
		}
	}, [inputValue])

	const calculateMovingAverage = useCallback(() => {
		if (data.length < 4) return

		const withMovingAverage = data.map((point, index) => {
			const ma =
				index >= 3
					? data
							.slice(index - 3, index + 1)
							.reduce((sum, p) => sum + p.value, 0) / 4
					: undefined
			return { ...point, movingAverage: ma }
		})

		const movingAverage = withMovingAverage.map((point, index) => {
			const cma =
				index >= 4
					? ((withMovingAverage[index - 1].movingAverage || 0) +
							(point.movingAverage || 0)) /
					  2
					: undefined
			const deviation = cma !== undefined ? point.value - cma : undefined
			return {
				...point,
				centeredMovingAverage: cma,
				deviationFromMovingAverage: deviation,
			}
		})

		setMovingAverageTable(movingAverage)
	}, [data])

	const calculateSeasonalComponents = useCallback(() => {
		if (movingAverageTable.length < 4) return

		const seasonLength = 4
		const seasonal = movingAverageTable.map((point, index) => {
			if (index < 3) return point // Skip first 3 points as they don't have centered moving average

			const seasonalComponent =
				model === 'additive'
					? point.value - (point.centeredMovingAverage || 0)
					: point.centeredMovingAverage && point.centeredMovingAverage !== 0
					? point.value / point.centeredMovingAverage
					: 1

			return { ...point, seasonalComponent }
		})

		const seasonalIndices = Array.from({ length: seasonLength }, (_, i) => i)
		const averageSeasonalComponents = seasonalIndices.map(seasonIndex => {
			const componentsForSeason = seasonal
				.filter(
					(_, index) => index >= 3 && (index - 3) % seasonLength === seasonIndex
				)
				.map(point => point.seasonalComponent || 0)

			return componentsForSeason.length
				? componentsForSeason.reduce((sum, comp) => sum + comp, 0) /
						componentsForSeason.length
				: 0
		})

		const sumAdjusted = averageSeasonalComponents.reduce((a, b) => a + b, 0)
		const adjustmentFactor =
			model === 'additive'
				? sumAdjusted / seasonLength
				: Math.pow(
						averageSeasonalComponents.reduce((a, b) => a * b, 1),
						1 / seasonLength
				  )

		const adjustedSeasonalComponents = averageSeasonalComponents.map(comp =>
			model === 'additive'
				? comp - adjustmentFactor
				: adjustmentFactor !== 0
				? comp / adjustmentFactor
				: 1
		)

		const seasonalWithAverages = seasonal.map((point, index) => {
			if (index < 3) return point
			const seasonIndex = (index - 3) % seasonLength
			return {
				...point,
				averageSeasonalComponent: averageSeasonalComponents[seasonIndex],
				adjustedSeasonalComponent: adjustedSeasonalComponents[seasonIndex],
			}
		})

		setSeasonalComponents(seasonalWithAverages)
	}, [movingAverageTable, model])

	const calculateTrendLine = (data: DataPoint[]) => {
		const filteredData = data.filter(
			point => point.centeredMovingAverage !== undefined
		)
		const sumX = filteredData.reduce((sum, point) => sum + point.period, 0)
		const sumY = filteredData.reduce(
			(sum, point) => sum + (point.centeredMovingAverage || 0),
			0
		)
		const sumXY = filteredData.reduce(
			(sum, point) => sum + point.period * (point.centeredMovingAverage || 0),
			0
		)
		const sumX2 = filteredData.reduce(
			(sum, point) => sum + point.period * point.period,
			0
		)
		const n = filteredData.length

		const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
		const intercept = (sumY - slope * sumX) / n

		return { slope, intercept }
	}

	const calculateModel = useCallback(() => {
		if (seasonalComponents.length === 0) return

		const { slope, intercept } = calculateTrendLine(seasonalComponents)

		const modelData = seasonalComponents.map(point => {
			const trend = slope * point.period + intercept
			const seasonal = point.adjustedSeasonalComponent || 0
			const tPlusSeasonal =
				model === 'additive' ? trend + seasonal : trend * seasonal
			const deseasonalized =
				model === 'additive'
					? point.value - seasonal
					: seasonal !== 0
					? point.value / seasonal
					: point.value // Avoid division by zero
			const error = point.value - tPlusSeasonal
			return {
				...point,
				trend,
				seasonal,
				tPlusSeasonal,
				deseasonalized,
				error,
				errorSquared: error * error,
			}
		})

		setModelTable(modelData)
	}, [seasonalComponents, model])

	const calculateForecast = useCallback(() => {
		if (modelTable.length === 0 || forecastPeriods === 0) return

		const { slope, intercept } = calculateTrendLine(seasonalComponents)
		const seasonLength = 4
		const lastPeriod = modelTable[modelTable.length - 1].period

		const forecast: DataPoint[] = []
		for (let i = 1; i <= forecastPeriods; i++) {
			const period = lastPeriod + i
			const trend = slope * period + intercept
			const seasonalIndex = (period - 1) % seasonLength
			const seasonal =
				seasonalComponents[seasonalIndex]?.adjustedSeasonalComponent || 0
			const forecastValue =
				model === 'additive'
					? trend + seasonal
					: trend * (seasonal !== 0 ? seasonal : 1) // Avoid multiplying by zero

			forecast.push({
				period,
				value: 0,
				forecast: forecastValue,
				trend,
				seasonal,
			})
		}

		setForecastData(forecast)
	}, [modelTable, forecastPeriods, model, seasonalComponents])

	useEffect(() => {
		calculateMovingAverage()
	}, [calculateMovingAverage])

	useEffect(() => {
		calculateSeasonalComponents()
	}, [calculateSeasonalComponents])

	useEffect(() => {
		calculateModel()
	}, [calculateModel])

	useEffect(() => {
		calculateForecast()
	}, [calculateForecast])

	const renderTable = (data: DataPoint[], caption: string) => (
		<div className='table-container'>
			<table>
				<caption>{caption}</caption>
				<thead>
					<tr>
						<th>Period</th>
						<th>Value</th>
						{caption === 'Moving Average Table' && (
							<>
								<th>Moving Average</th>
								<th>Centered Moving Average</th>
								<th>Deviation from the moving average</th>
							</>
						)}
						{caption === 'Seasonal Components Table' && (
							<>
								<th>Centered MA</th>
								<th>Seasonal Component</th>
								<th>Average Seasonal</th>
								<th>Adjusted Seasonal</th>
							</>
						)}
						{caption === 'Model Table' && (
							<>
								<th>Trend</th>
								<th>S</th>
								<th>Deseasonalized</th>
								<th>e</th>
							</>
						)}
					</tr>
				</thead>
				<tbody>
					{data.map(row => (
						<tr key={row.period}>
							<td>{row.period}</td>
							<td>{row.value.toFixed(2)}</td>
							{caption === 'Moving Average Table' && (
								<>
									<td>{row.movingAverage?.toFixed(2)}</td>
									<td>{row.centeredMovingAverage?.toFixed(2)}</td>
									<td>{row.deviationFromMovingAverage?.toFixed(2)}</td>
								</>
							)}
							{caption === 'Seasonal Components Table' && (
								<>
									<td>{row.centeredMovingAverage?.toFixed(2)}</td>
									<td>{row.seasonalComponent?.toFixed(2)}</td>
									<td>{row.averageSeasonalComponent?.toFixed(2)}</td>
									<td>{row.adjustedSeasonalComponent?.toFixed(2)}</td>
								</>
							)}
							{caption === 'Model Table' && (
								<>
									<td>{row.trend?.toFixed(2)}</td>
									<td>{row.seasonal?.toFixed(2)}</td>
									<td>{row.deseasonalized?.toFixed(2)}</td>
									<td>{row.error?.toFixed(2)}</td>
								</>
							)}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)

	const renderChart = useCallback(
		() => (
			<div className='chart-wrapper'>
				<ResponsiveContainer width='100%' height={400}>
					<LineChart data={data}>
						<CartesianGrid strokeDasharray='3 3' />
						<XAxis dataKey='period' />
						<YAxis />
						<Tooltip />
						<Legend />
						<Line
							type='monotone'
							dataKey='value'
							stroke='#8884d8'
							name='Actual'
						/>
						{modelTable.length > 0 && (
							<Line
								type='monotone'
								data={modelTable}
								dataKey='tPlusSeasonal'
								stroke='#82ca9d'
								name='Model'
							/>
						)}
					</LineChart>
				</ResponsiveContainer>
			</div>
		),
		[data, modelTable]
	)

	const renderForecastTable = useCallback(
		() => (
			<div className='table-container'>
				<table>
					<caption>Forecast Table</caption>
					<thead>
						<tr>
							<th>Period</th>
							<th>Forecast Value</th>
						</tr>
					</thead>
					<tbody>
						{forecastData.map(row => (
							<tr key={row.period}>
								<td>{row.period}</td>
								<td>{row.forecast?.toFixed(2)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		),
		[forecastData]
	)

	return (
		<div className='container'>
			<h1>Sales Forecast</h1>

			<div className='input-group'>
				<input
					type='number'
					value={inputValue}
					onChange={e => setInputValue(e.target.value)}
					placeholder='Enter sales value'
				/>
				<button onClick={handleAddDataPoint}>Add Data Point</button>
			</div>

			<div className='input-group'>
				<input
					type='number'
					value={forecastPeriods}
					onChange={e => setForecastPeriods(parseInt(e.target.value) || 0)}
					placeholder='Number of forecast periods'
				/>
			</div>

			<div className='input-group'>
				<select onChange={e => setModel(e.target.value as Model)} value={model}>
					<option value='additive'>Additive</option>
					<option value='multiplicative'>Multiplicative</option>
				</select>
			</div>

			<div className='tab-group'>
				{['moving-average', 'seasonal', 'model', 'chart', 'forecast'].map(
					tab => (
						<button
							key={tab}
							onClick={() => setActiveTab(tab)}
							className={`tab-button ${activeTab === tab ? 'active' : ''}`}
						>
							{tab.charAt(0).toUpperCase() + tab.slice(1)}
						</button>
					)
				)}
			</div>

			{activeTab === 'moving-average' &&
				movingAverageTable.length > 0 &&
				renderTable(movingAverageTable, 'Moving Average Table')}
			{activeTab === 'seasonal' &&
				seasonalComponents.length > 0 &&
				renderTable(seasonalComponents, 'Seasonal Components Table')}
			{activeTab === 'model' &&
				modelTable.length > 0 &&
				renderTable(modelTable, 'Model Table')}
			{activeTab === 'chart' && data.length > 0 && (
				<div className='chart-container'>{renderChart()}</div>
			)}
			{activeTab === 'forecast' &&
				forecastData.length > 0 &&
				renderForecastTable()}
		</div>
	)
}

export default SalesForecast
