CREATE TABLE IF NOT EXISTS public.profiles (
    user_id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'master')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.rocha_fitness_has_profile()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE user_id = (SELECT auth.uid())
          AND role IN ('admin', 'master')
    );
$$;

CREATE OR REPLACE FUNCTION public.rocha_fitness_is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles AS profile
        WHERE profile.user_id = (SELECT auth.uid())
          AND profile.role IN ('admin', 'master')
          AND (
              profile.role = 'master'
              OR NOT EXISTS (
                  SELECT 1
                  FROM public.app_settings AS setting
                  WHERE setting.key = 'license_expires_at'
                    AND setting.value IS NOT NULL
                    AND setting.value < to_char(CURRENT_DATE, 'YYYY-MM-DD')
              )
          )
    );
$$;

CREATE OR REPLACE FUNCTION public.rocha_fitness_is_master()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE user_id = (SELECT auth.uid())
          AND role = 'master'
    );
$$;

REVOKE ALL ON FUNCTION public.rocha_fitness_has_profile() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rocha_fitness_is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rocha_fitness_is_master() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rocha_fitness_has_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rocha_fitness_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rocha_fitness_is_master() TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_rocha_fitness_record()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SET search_path = ''
AS $$
DECLARE
    payload JSONB;
    allowed_fields TEXT[];
    item RECORD;
    amount NUMERIC;
BEGIN
    IF NEW.collection NOT IN ('usuarios', 'clientes', 'funcionarios', 'financas') THEN
        RAISE EXCEPTION 'Coleção não permitida.';
    END IF;

    payload := NEW.data::jsonb;
    IF jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'O cadastro deve ser um objeto JSON.';
    END IF;

    CASE NEW.collection
        WHEN 'usuarios' THEN
            allowed_fields := ARRAY['nome', 'email', 'perfil', 'telefone'];
        WHEN 'clientes' THEN
            allowed_fields := ARRAY[
                'nome', 'telefone', 'email', 'nascimento', 'plano', 'vencimento', 'status'
            ];
        WHEN 'funcionarios' THEN
            allowed_fields := ARRAY['nome', 'cargo', 'telefone', 'email', 'admissao'];
        WHEN 'financas' THEN
            allowed_fields := ARRAY[
                'descricao', 'tipo', 'categoria', 'valor', 'data', 'status'
            ];
    END CASE;

    FOR item IN SELECT key, value FROM jsonb_each(payload)
    LOOP
        IF NOT (item.key = ANY (allowed_fields)) THEN
            RAISE EXCEPTION 'O cadastro contém campos não reconhecidos.';
        END IF;
        IF jsonb_typeof(item.value) NOT IN ('string', 'number') THEN
            RAISE EXCEPTION 'Os dados do cadastro devem ser valores simples.';
        END IF;
    END LOOP;

    IF NEW.collection = 'usuarios' THEN
        IF NULLIF(btrim(payload ->> 'nome'), '') IS NULL
           OR NULLIF(btrim(payload ->> 'email'), '') IS NULL THEN
            RAISE EXCEPTION 'Preencha todos os campos obrigatórios.';
        END IF;
        IF payload ? 'perfil' AND payload ->> 'perfil' <> ''
           AND payload ->> 'perfil' NOT IN ('Administrador', 'Recepção', 'Financeiro') THEN
            RAISE EXCEPTION 'Perfil de acesso inválido.';
        END IF;
    ELSIF NEW.collection = 'clientes' THEN
        IF NULLIF(btrim(payload ->> 'nome'), '') IS NULL
           OR NULLIF(btrim(payload ->> 'telefone'), '') IS NULL THEN
            RAISE EXCEPTION 'Preencha todos os campos obrigatórios.';
        END IF;
        IF payload ? 'plano' AND payload ->> 'plano' <> ''
           AND payload ->> 'plano' NOT IN ('Semestral', 'Trimestral', 'Mensal', 'Casal') THEN
            RAISE EXCEPTION 'Plano inválido.';
        END IF;
        IF payload ? 'status' AND payload ->> 'status' <> ''
           AND payload ->> 'status' NOT IN ('Ativo', 'Inativo') THEN
            RAISE EXCEPTION 'Status inválido.';
        END IF;
    ELSIF NEW.collection = 'funcionarios' THEN
        IF NULLIF(btrim(payload ->> 'nome'), '') IS NULL
           OR NULLIF(btrim(payload ->> 'cargo'), '') IS NULL THEN
            RAISE EXCEPTION 'Preencha todos os campos obrigatórios.';
        END IF;
    ELSIF NEW.collection = 'financas' THEN
        IF NULLIF(btrim(payload ->> 'descricao'), '') IS NULL
           OR NULLIF(btrim(payload ->> 'valor'), '') IS NULL
           OR NULLIF(btrim(payload ->> 'data'), '') IS NULL THEN
            RAISE EXCEPTION 'Preencha todos os campos obrigatórios.';
        END IF;
        IF payload ->> 'valor' !~ '^[0-9]+([.][0-9]{1,2})?$' THEN
            RAISE EXCEPTION 'Informe um valor financeiro válido.';
        END IF;
        amount := (payload ->> 'valor')::numeric;
        IF amount <= 0 THEN
            RAISE EXCEPTION 'O valor financeiro deve ser maior que zero.';
        END IF;
        IF payload ? 'tipo' AND payload ->> 'tipo' <> ''
           AND payload ->> 'tipo' NOT IN ('Receita', 'Despesa') THEN
            RAISE EXCEPTION 'Tipo financeiro inválido.';
        END IF;
        IF payload ? 'categoria' AND payload ->> 'categoria' <> ''
           AND payload ->> 'categoria' NOT IN (
               'Mensalidade', 'Matrícula', 'Folha de pagamento',
               'Aluguel', 'Equipamentos', 'Outros'
           ) THEN
            RAISE EXCEPTION 'Categoria financeira inválida.';
        END IF;
        IF payload ? 'status' AND payload ->> 'status' <> ''
           AND payload ->> 'status' NOT IN ('Pago', 'Pendente') THEN
            RAISE EXCEPTION 'Status financeiro inválido.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_rocha_fitness_record ON public.records;
CREATE TRIGGER validate_rocha_fitness_record
BEFORE INSERT OR UPDATE OF collection, data ON public.records
FOR EACH ROW EXECUTE FUNCTION public.validate_rocha_fitness_record();

REVOKE ALL ON FUNCTION public.validate_rocha_fitness_record() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.records FROM anon, authenticated;
REVOKE ALL ON TABLE public.admin_users FROM anon, authenticated;
REVOKE ALL ON TABLE public.app_settings FROM anon, authenticated;
REVOKE ALL ON TABLE public.profiles FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.records TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.app_settings TO authenticated;
GRANT SELECT (user_id, email, role, created_at)
    ON TABLE public.profiles TO authenticated;

DROP POLICY IF EXISTS records_admin_select ON public.records;
CREATE POLICY records_admin_select ON public.records
    FOR SELECT TO authenticated
    USING (
        public.rocha_fitness_is_admin()
        AND collection IN ('usuarios', 'clientes', 'funcionarios', 'financas')
    );

DROP POLICY IF EXISTS records_admin_insert ON public.records;
CREATE POLICY records_admin_insert ON public.records
    FOR INSERT TO authenticated
    WITH CHECK (
        public.rocha_fitness_is_admin()
        AND collection IN ('usuarios', 'clientes', 'funcionarios', 'financas')
    );

DROP POLICY IF EXISTS records_admin_update ON public.records;
CREATE POLICY records_admin_update ON public.records
    FOR UPDATE TO authenticated
    USING (
        public.rocha_fitness_is_admin()
        AND collection IN ('usuarios', 'clientes', 'funcionarios', 'financas')
    )
    WITH CHECK (
        public.rocha_fitness_is_admin()
        AND collection IN ('usuarios', 'clientes', 'funcionarios', 'financas')
    );

DROP POLICY IF EXISTS records_admin_delete ON public.records;
CREATE POLICY records_admin_delete ON public.records
    FOR DELETE TO authenticated
    USING (
        public.rocha_fitness_is_admin()
        AND collection IN ('usuarios', 'clientes', 'funcionarios', 'financas')
    );

DROP POLICY IF EXISTS profiles_read_self_or_master ON public.profiles;
CREATE POLICY profiles_read_self_or_master ON public.profiles
    FOR SELECT TO authenticated
    USING (
        user_id = (SELECT auth.uid())
        OR public.rocha_fitness_is_master()
    );

DROP POLICY IF EXISTS app_settings_read_license ON public.app_settings;
CREATE POLICY app_settings_read_license ON public.app_settings
    FOR SELECT TO authenticated
    USING (
        key = 'license_expires_at'
        AND public.rocha_fitness_has_profile()
    );

DROP POLICY IF EXISTS app_settings_master_insert_license ON public.app_settings;
CREATE POLICY app_settings_master_insert_license ON public.app_settings
    FOR INSERT TO authenticated
    WITH CHECK (
        key = 'license_expires_at'
        AND public.rocha_fitness_is_master()
    );

DROP POLICY IF EXISTS app_settings_master_update_license ON public.app_settings;
CREATE POLICY app_settings_master_update_license ON public.app_settings
    FOR UPDATE TO authenticated
    USING (
        key = 'license_expires_at'
        AND public.rocha_fitness_is_master()
    )
    WITH CHECK (
        key = 'license_expires_at'
        AND public.rocha_fitness_is_master()
    );
