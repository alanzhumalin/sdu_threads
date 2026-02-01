package main

import (
	"log"

	"sduthreads/internal/app"
	"sduthreads/internal/config"
	"sduthreads/internal/db"
)

func main() {
	cfg := config.Load()

	client, err := db.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db connect error: %v", err)
	}

	if err := client.Migrate("./internal/db/migrations"); err != nil {
		log.Fatalf("db migrate error: %v", err)
	}

	server := app.NewServer(cfg, client)
	if err := server.Start(); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
