import uvicorn
from src.config import load_config

if __name__ == "__main__":
    config = load_config()
    uvicorn.run("src.app:app", host=config.server.host, port=config.server.port, reload=False)
