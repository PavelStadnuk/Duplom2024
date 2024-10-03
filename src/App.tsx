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
import * as XLSX from 'xlsx'
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
					? (data[index].value +
							data[index - 1].value +
							data[index - 2].value +
							data[index - 3].value) /
					  4
					: undefined
			return { ...point, movingAverage: ma }
		})

		const movingAverage = withMovingAverage.map((point, index) => {
			const cma =
				index >= 3 && index < withMovingAverage.length - 1
					? (withMovingAverage[index].movingAverage! +
							withMovingAverage[index + 1].movingAverage!) /
					  2
					: undefined
			return {
				...point,
				centeredMovingAverage: cma,
				deviationFromMovingAverage:
					cma !== undefined ? point.value - cma : undefined,
			}
		})

		setMovingAverageTable(movingAverage)
	}, [data])

	const calculateSeasonalComponents = useCallback(() => {
		if (movingAverageTable.length < 4) return

		const seasonLength = 4
		const seasonal = movingAverageTable.map(point => {
			if (point.centeredMovingAverage === undefined) return point

			let seasonalComponent
			if (model === 'additive') {
				seasonalComponent = point.value - point.centeredMovingAverage
			} else {
				seasonalComponent = point.value / point.centeredMovingAverage - 1
			}

			return {
				...point,
				seasonalComponent,
				deseasonalized:
					model === 'additive'
						? point.value - seasonalComponent
						: point.value / (1 + seasonalComponent),
			}
		})

		const averageSeasonalComponents = Array.from(
			{ length: seasonLength },
			(_, i) => {
				const componentsForSeason = seasonal
					.filter(
						(_, index) =>
							index % seasonLength === i && _.seasonalComponent !== undefined
					)
					.map(point => point.seasonalComponent!)
				return componentsForSeason.length
					? componentsForSeason.reduce((sum, comp) => sum + comp, 0) /
							componentsForSeason.length
					: 0
			}
		)

		const sumAdjusted = averageSeasonalComponents.reduce((a, b) => a + b, 0)
		const adjustmentFactor =
			model === 'additive' ? sumAdjusted / seasonLength : sumAdjusted

		const seasonalWithAverages = seasonal.map((point, index) => {
			const avgSeasonalComponent =
				averageSeasonalComponents[index % seasonLength]
			const adjustedSeasonalComponent =
				model === 'additive'
					? avgSeasonalComponent - adjustmentFactor
					: avgSeasonalComponent / (1 + adjustmentFactor)

			return {
				...point,
				averageSeasonalComponent: avgSeasonalComponent,
				adjustedSeasonalComponent: adjustedSeasonalComponent,
				deseasonalized:
					point.value !== undefined && adjustedSeasonalComponent !== undefined
						? model === 'additive'
							? point.value - adjustedSeasonalComponent
							: point.value / (1 + adjustedSeasonalComponent)
						: undefined,
			}
		})

		setSeasonalComponents(seasonalWithAverages)
	}, [movingAverageTable, model])

	const calculateTrendLine = (data: DataPoint[]) => {
		const filteredData = data.filter(
			point => point.centeredMovingAverage !== undefined
		)
		const n = filteredData.length

		if (n === 0) return { slope: 0, intercept: 0 }

		const sumX = filteredData.reduce((sum, point) => sum + point.period, 0)
		const sumY = filteredData.reduce((sum, point) => {
			return sum + (point.deseasonalized || point.centeredMovingAverage || 0)
		}, 0)
		const sumXY = filteredData.reduce((sum, point) => {
			return (
				sum +
				point.period *
					(point.deseasonalized || point.centeredMovingAverage || 0)
			)
		}, 0)
		const sumXX = filteredData.reduce(
			(sum, point) => sum + point.period * point.period,
			0
		)

		const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX)
		const intercept = (sumY - slope * sumX) / n

		return { slope, intercept }
	}

	const calculateModel = useCallback(() => {
		if (seasonalComponents.length === 0) return

		const deseasonalizedData = seasonalComponents.map(point => ({
			period: point.period,
			value: point.deseasonalized || 0,
			centeredMovingAverage: point.centeredMovingAverage,
		}))

		const { slope, intercept } = calculateTrendLine(deseasonalizedData)

		const modelData = seasonalComponents.map(point => {
			const trend = slope * point.period + intercept
			const seasonal = point.adjustedSeasonalComponent || 0

			let tPlusSeasonal
			if (model === 'additive') {
				tPlusSeasonal = trend + seasonal
			} else {
				tPlusSeasonal = trend * (1 + seasonal)
			}

			const error = point.value - tPlusSeasonal

			return {
				...point,
				trend,
				seasonal,
				tPlusSeasonal,
				error,
				errorSquared: error * error,
				deseasonalized: point.deseasonalized,
			}
		})

		setModelTable(modelData)
	}, [seasonalComponents, model])

	const calculateForecast = useCallback(() => {
		if (modelTable.length === 0 || forecastPeriods === 0) return

		const { slope, intercept } = calculateTrendLine(seasonalComponents)
		const seasonLength = 4
		const lastPeriod = modelTable[modelTable.length - 1].period
		const lastActualValue = modelTable[modelTable.length - 1].value
		const lastTrendValue = modelTable[modelTable.length - 1].tPlusSeasonal || 0

		const forecast: DataPoint[] = []

		// Додаємо останню точку актуальних даних до прогнозу для з'єднання
		forecast.push({
			period: lastPeriod,
			value: lastActualValue,
			forecast: lastTrendValue,
			trend: slope * lastPeriod + intercept,
			seasonal:
				seasonalComponents[lastPeriod - 1]?.adjustedSeasonalComponent || 0,
		})

		// Додаємо прогнозні точки
		for (let i = 1; i <= forecastPeriods; i++) {
			const period = lastPeriod + i
			const trend = slope * period + intercept
			const seasonalIndex = (period - 1) % seasonLength
			const seasonal =
				seasonalComponents[seasonalIndex]?.adjustedSeasonalComponent || 0

			const forecastValue =
				model === 'additive' ? trend + seasonal : trend * (1 + seasonal)

			forecast.push({
				period,
				value: 0,
				forecast: forecastValue,
				trend,
				seasonal,
			})
		}

		setForecastData(forecast)
	}, [modelTable, forecastPeriods, seasonalComponents, model])

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
								<th>Deviation from Moving Average</th>
							</>
						)}
						{caption === 'Seasonal Components Table' && (
							<>
								<th>Centered MA</th>
								<th>Seasonal Component</th>
								<th>Average Seasonal</th>
								<th>Adjusted Seasonal</th>
								<th>Deseasonalized</th>
							</>
						)}
						{caption === 'Model Table' && (
							<>
								<th>Trend</th>
								<th>Seasonal</th>
								<th>T+S</th>
								<th>Error</th>
								<th>Deseasonalized</th>
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
									<td>{row.deseasonalized?.toFixed(2)}</td>
								</>
							)}
							{caption === 'Model Table' && (
								<>
									<td>{row.trend?.toFixed(2)}</td>
									<td>{row.seasonal?.toFixed(2)}</td>
									<td>{row.tPlusSeasonal?.toFixed(2)}</td>
									<td>{row.error?.toFixed(2)}</td>
									<td>{row.deseasonalized?.toFixed(2)}</td>
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
					<LineChart>
						<CartesianGrid strokeDasharray='3 3' />
						<XAxis
							dataKey='period'
							type='number'
							domain={['dataMin', 'dataMax']}
							allowDataOverflow={true}
						/>
						<YAxis domain={['auto', 'auto']} />
						<Tooltip />
						<Legend />

						{/* Actual data line */}
						<Line
							data={data}
							type='monotone'
							dataKey='value'
							stroke='#8884d8'
							name='Actual'
							dot
							connectNulls
						/>

						{/* Model line */}
						{modelTable.length > 0 && (
							<Line
								data={modelTable}
								type='monotone'
								dataKey='tPlusSeasonal'
								stroke='#82ca9d'
								name='Model'
								dot
								connectNulls
							/>
						)}

						{/* Forecast line */}
						{forecastData.length > 0 && (
							<Line
								data={forecastData}
								type='monotone'
								dataKey='forecast'
								stroke='#ffc658'
								name='Forecast'
								dot
								connectNulls
								strokeDasharray='3 3'
							/>
						)}
					</LineChart>
				</ResponsiveContainer>
			</div>
		),
		[data, modelTable, forecastData]
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
							<th>Trend</th>
							<th>Seasonal</th>
						</tr>
					</thead>
					<tbody>
						{forecastData.map(row => (
							<tr key={row.period}>
								<td>{row.period}</td>
								<td>{row.forecast?.toFixed(2)}</td>
								<td>{row.trend?.toFixed(2)}</td>
								<td>{row.seasonal?.toFixed(2)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		),
		[forecastData]
	)

	const downloadExcel = useCallback(() => {
		const workbook = XLSX.utils.book_new()

		// Helper function to convert data to worksheet
		const dataToSheet = (data: DataPoint[], sheetName: string) => {
			const worksheet = XLSX.utils.json_to_sheet(data)
			XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
		}

		// Add sheets for each table
		dataToSheet(movingAverageTable, 'Moving Average')
		dataToSheet(seasonalComponents, 'Seasonal Components')
		dataToSheet(modelTable, 'Model')
		dataToSheet(forecastData, 'Forecast')

		// Generate Excel file
		XLSX.writeFile(workbook, 'sales_forecast.xlsx')
	}, [movingAverageTable, seasonalComponents, modelTable, forecastData])

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
			<div className='button-group'>
				<button onClick={downloadExcel} className='download-button'>
					Download Excel
				</button>
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
