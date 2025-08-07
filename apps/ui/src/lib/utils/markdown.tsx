import { Highlight, themes } from "prism-react-renderer";
import React from "react";

import type { Language } from "prism-react-renderer";

// Syntax highlighted pre component
const SyntaxHighlightedPre = ({
	children,
	...props
}: {
	children: React.ReactNode;
	[key: string]: any;
}) => {
	// Extract code content and language from children
	let code = "";
	let language: Language = "text";

	if (children && typeof children === "object" && "props" in children) {
		const childProps = (children as any).props;
		if (childProps?.children) {
			code = childProps.children.trim();
		}
		if (childProps?.className) {
			const match = childProps.className.match(/language-(\w+)/);
			if (match) {
				language = match[1] as Language;
			}
		}
	}

	// If no code content, return a simple pre element
	if (!code) {
		return (
			<pre
				className="bg-muted p-4 rounded-lg text-sm font-mono overflow-x-auto mb-4"
				{...props}
			>
				{children}
			</pre>
		);
	}

	return (
		<div className="mb-4 overflow-hidden rounded-lg">
			{/* Light theme code block */}
			<div className="block dark:hidden">
				<Highlight code={code} language={language} theme={themes.github}>
					{({ className, style, tokens, getLineProps, getTokenProps }) => (
						<pre
							className={`${className} p-4 overflow-x-auto text-sm font-mono`}
							style={{
								...style,
								margin: 0,
								borderRadius: 0,
							}}
							{...props}
						>
							{tokens.map((line, i) => {
								const lineProps = getLineProps({ line });
								return (
									<div key={i} {...lineProps}>
										{line.map((token, key) => {
											const tokenProps = getTokenProps({ token });
											return <span key={key} {...tokenProps} />;
										})}
									</div>
								);
							})}
						</pre>
					)}
				</Highlight>
			</div>
			{/* Dark theme code block */}
			<div className="hidden dark:block">
				<Highlight code={code} language={language} theme={themes.dracula}>
					{({ className, style, tokens, getLineProps, getTokenProps }) => (
						<pre
							className={`${className} p-4 overflow-x-auto text-sm font-mono`}
							style={{
								...style,
								margin: 0,
								borderRadius: 0,
							}}
							{...props}
						>
							{tokens.map((line, i) => {
								const lineProps = getLineProps({ line });
								return (
									<div key={i} {...lineProps}>
										{line.map((token, key) => {
											const tokenProps = getTokenProps({ token });
											return <span key={key} {...tokenProps} />;
										})}
									</div>
								);
							})}
						</pre>
					)}
				</Highlight>
			</div>
		</div>
	);
};

export interface ChangelogFrontmatter {
	id: string;
	slug: string;
	date: string;
	title: string;
	summary: string;
	image: {
		src: string;
		alt: string;
		width: number;
		height: number;
	};
}

export interface ChangelogEntry extends ChangelogFrontmatter {
	content: string;
}

// Get markdown component options with custom styling
export function getMarkdownOptions() {
	return {
		overrides: {
			h1: {
				props: {
					className:
						"text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-6",
				},
			},
			h2: {
				props: {
					className: "text-2xl font-semibold text-foreground mt-8 mb-4",
				},
			},
			h3: {
				props: {
					className: "text-xl font-medium text-foreground mt-6 mb-3",
				},
			},
			p: {
				props: {
					className: "text-muted-foreground leading-relaxed mb-4",
				},
			},
			ul: {
				props: {
					className: "space-y-2 mb-4",
				},
			},
			li: {
				props: {
					className: "text-muted-foreground flex items-start gap-2",
				},
			},
			strong: {
				props: {
					className: "text-foreground font-semibold",
				},
			},
			code: {
				props: {
					className:
						"bg-muted text-muted-foreground px-2 py-1 rounded text-sm font-mono",
				},
			},
			pre: {
				component: SyntaxHighlightedPre,
			},
			blockquote: {
				props: {
					className:
						"border-l-4 border-primary pl-4 italic text-muted-foreground mb-4",
				},
			},
			a: {
				props: {
					className: "text-primary hover:text-primary/80 underline",
				},
			},
			hr: {
				props: {
					className: "border-border my-8",
				},
			},
		},
	};
}
