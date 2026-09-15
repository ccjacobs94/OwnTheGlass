FROM python:3.11-slim

WORKDIR /app

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CONFIG_PATH=/app/config/config.yaml

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source files
COPY src/ ./src/
COPY main.py .
COPY config.yaml ./config_example.yaml

# Create persistent directories
RUN mkdir -p /app/config /app/data

# Default port
EXPOSE 8484

CMD ["python", "main.py"]
