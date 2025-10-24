"use client";
import { addDays, format, parseISO, subDays } from "date-fns";
import { useSearchParams } from "next/navigation";
import {
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
	CartesianGrid,
} from "recharts";

import { useDashboardState } from "@/lib/dashboard-state";
import { useApi } from "@/lib/fetch-client";

import type { ActivitT } from "@/types/activity";
import type { TooltipProps } from "recharts";

interface CacheRateChartProps {
	initialData?: ActivitT;
	projectId: string | undefined;
}

const CustomTooltip = ({
	active,
	payload,
	label,
}: TooltipProps<number, string> & {
	payload: { value: number }[];
	label: string;
}) => {
	return (
		<div className="rounded-lg border bg-popover text-popover-foreground p-2 shadow-sm">
			<p className="font-medium">
				{label && format(parseISO(label), "MMM d, yyyy")}
			</p>
			<p className="text-sm">
				<span className="font-medium">
					{Number(payload[0].value).toFixed(2)}%
				</span>{" "}
				Cache Rate
			</p>
		</div>
	);
};

export function CacheRateChart({
	initialData,
	projectId,
}: CacheRateChartProps) {
	const searchParams = useSearchParams();
	const { selectedProject } = useDashboardState();

	// Get days from URL parameter
	const daysParam = searchParams.get("days");
	const days = daysParam === "30" ? 30 : 7;

	const api = useApi();
	const { data, isLoading, error } = api.useQuery(
		"get",
		"/activity",
		{
			params: {
				query: {
					days: String(days),
					...(projectId ? { projectId: projectId } : {}),
				},
			},
		},
		{
			enabled: !!projectId,
			initialData,
		},
	);

	if (!projectId) {
		return (
			<div className="flex h-[350px] items-center justify-center">
				<p className="text-muted-foreground">
					Please select a project to view cache rate data
				</p>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="flex h-[350px] items-center justify-center">
				Loading cache rate data...
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex h-[350px] items-center justify-center">
				<p className="text-destructive">Error loading activity data</p>
			</div>
		);
	}

	if (!data || data.activity.length === 0) {
		return (
			<div className="flex h-[350px] items-center justify-center">
				<p className="text-muted-foreground">
					No cache rate data available
					{selectedProject && (
						<span className="block mt-1 text-sm">
							Project: {selectedProject.name}
						</span>
					)}
				</p>
			</div>
		);
	}

	const today = new Date();
	const startDate = subDays(today, days - 1);
	const dateRange: string[] = [];

	for (let i = 0; i < days; i++) {
		const date = addDays(startDate, i);
		dateRange.push(format(date, "yyyy-MM-dd"));
	}

	const dataByDate = new Map(data.activity.map((item) => [item.date, item]));

	const chartData = dateRange.map((date) => {
		if (dataByDate.has(date)) {
			const dayData = dataByDate.get(date)!;
			return {
				date,
				formattedDate: format(parseISO(date), "MMM d"),
				cacheRate: dayData.cacheRate,
			};
		}
		return {
			date,
			formattedDate: format(parseISO(date), "MMM d"),
			cacheRate: 0,
		};
	});

	return (
		<div className="flex flex-col">
			<ResponsiveContainer width="100%" height={350}>
				<LineChart
					data={chartData}
					margin={{
						top: 5,
						right: 10,
						left: 10,
						bottom: 0,
					}}
				>
					<CartesianGrid strokeDasharray="3 3" vertical={false} />
					<XAxis
						dataKey="date"
						tickFormatter={(value) => format(parseISO(value), "MMM d")}
						stroke="#888888"
						fontSize={12}
						tickLine={false}
						axisLine={false}
					/>
					<YAxis
						stroke="#888888"
						fontSize={12}
						tickLine={false}
						axisLine={false}
						tickFormatter={(value) => `${value.toFixed(1)}%`}
					/>
					<Tooltip
						content={<CustomTooltip payload={[{ value: 0 }]} label="test" />}
						cursor={{
							stroke: "hsl(var(--muted-foreground))",
							strokeWidth: 1,
							strokeDasharray: "5 5",
						}}
					/>
					<Line
						type="monotone"
						dataKey="cacheRate"
						stroke="currentColor"
						className="stroke-primary"
						strokeWidth={2}
						dot={false}
					/>
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
}
