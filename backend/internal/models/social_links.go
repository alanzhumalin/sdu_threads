package models

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
)

// SocialLinks is stored in Postgres as JSONB.
// Keys are limited by validation in service layer.
type SocialLinks map[string]string

func (s SocialLinks) Value() (driver.Value, error) {
	if s == nil {
		return nil, nil
	}
	b, err := json.Marshal(map[string]string(s))
	if err != nil {
		return nil, err
	}
	return b, nil
}

func (s *SocialLinks) Scan(value interface{}) error {
	if value == nil {
		*s = nil
		return nil
	}

	var b []byte
	switch v := value.(type) {
	case []byte:
		b = v
	case string:
		b = []byte(v)
	default:
		return fmt.Errorf("social_links: unsupported scan type %T", value)
	}

	if len(b) == 0 {
		*s = nil
		return nil
	}

	var m map[string]string
	if err := json.Unmarshal(b, &m); err != nil {
		return err
	}
	*s = SocialLinks(m)
	return nil
}
