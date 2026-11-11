"""TCS backend: market history, pattern detection and setup statistics.

One rule set (``tcs.analysis``) serves both the chart (recent candles) and the
background statistics job (one to two years of history), so a pattern on the
chart is measured with exactly the rules that found it.
"""
